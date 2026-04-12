const STRUCTURED_OUTPUT_UNSUPPORTED_PATTERN = /(json_schema|response_format|tools?|tool_choice|unsupported|unknown|invalid.+schema)/i;

const RESPONSE_SHAPE_GUIDANCE = `Return valid JSON only with this exact shape:
{
  "responses": [
    {
      "prompt": "<prompt text>",
      "response": "<answer or Not found>",
      "source": "<supporting quote or Not found>",
      "page": "<page number or N/A>"
    }
  ]
}
Do not include markdown fences or explanatory text.`;

const responseSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    responses: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          prompt: { type: 'string' },
          response: { type: 'string' },
          source: { type: 'string' },
          page: { type: 'string' }
        },
        required: ['prompt', 'response', 'source', 'page']
      }
    }
  },
  required: ['responses']
};

const extractionTool = {
  type: 'function',
  function: {
    name: 'submit_extraction',
    description: 'Submit extracted answers for all prompts with supporting source text and page.',
    parameters: responseSchema
  }
};

function contentToText(value) {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (typeof part === 'string') {
          return part;
        }

        if (part?.type === 'text' && typeof part?.text === 'string') {
          return part.text;
        }

        if (typeof part?.content === 'string') {
          return part.content;
        }

        return '';
      })
      .join('')
      .trim();
  }

  if (value && typeof value === 'object' && typeof value.text === 'string') {
    return value.text;
  }

  return '';
}

function stripCodeFences(rawText) {
  return rawText
    .replace(/\`\`\`json\s*/gi, '')
    .replace(/\`\`\`\s*/g, '')
    .trim();
}

function findBalancedJsonSubstring(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    return null;
  }

  const startIndices = [];
  const objectStart = rawText.indexOf('{');
  const arrayStart = rawText.indexOf('[');

  if (objectStart >= 0) {
    startIndices.push(objectStart);
  }
  if (arrayStart >= 0) {
    startIndices.push(arrayStart);
  }

  if (startIndices.length === 0) {
    return null;
  }

  const start = Math.min(...startIndices);
  const openingChar = rawText[start];
  const closingChar = openingChar === '{' ? '}' : ']';

  let depth = 0;
  let inString = false;
  let isEscaped = false;

  for (let index = start; index < rawText.length; index += 1) {
    const char = rawText[index];

    if (inString) {
      if (isEscaped) {
        isEscaped = false;
      } else if (char === '\\') {
        isEscaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === openingChar) {
      depth += 1;
    } else if (char === closingChar) {
      depth -= 1;
      if (depth === 0) {
        return rawText.slice(start, index + 1);
      }
    }
  }

  return null;
}

function tryParseJson(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    return null;
  }

  const cleanedText = stripCodeFences(rawText);

  try {
    return JSON.parse(cleanedText);
  } catch {
    const candidate = findBalancedJsonSubstring(cleanedText);
    if (!candidate) {
      return null;
    }

    try {
      return JSON.parse(candidate);
    } catch {
      return null;
    }
  }
}

function extractBackendErrorMessage(payload) {
  if (!payload) {
    return '';
  }

  if (typeof payload === 'string') {
    return payload;
  }

  if (typeof payload?.error?.message === 'string') {
    return payload.error.message;
  }

  if (typeof payload?.message === 'string') {
    return payload.message;
  }

  if (typeof payload?.detail === 'string') {
    return payload.detail;
  }

  if (typeof payload?.rawText === 'string') {
    return payload.rawText.trim();
  }

  return '';
}

function summarizeResponseShape(data) {
  if (!data || typeof data !== 'object') {
    return 'empty or non-object response';
  }

  const keys = Object.keys(data).slice(0, 8);
  const choice = data.choices?.[0];
  const message = choice?.message;
  const summary = {
    topLevelKeys: keys,
    hasChoicesArray: Array.isArray(data.choices),
    choiceKeys: choice && typeof choice === 'object' ? Object.keys(choice).slice(0, 8) : [],
    messageKeys: message && typeof message === 'object' ? Object.keys(message).slice(0, 8) : [],
    hasToolCalls: Array.isArray(message?.tool_calls) && message.tool_calls.length > 0,
    contentType: Array.isArray(message?.content) ? 'array' : typeof message?.content
  };

  return JSON.stringify(summary);
}

function extractCandidatePayloads(data) {
  const candidates = [];
  const addCandidate = (value, label) => {
    if (value === undefined || value === null) {
      return;
    }

    candidates.push({ value, label });
  };

  const message = data?.choices?.[0]?.message;
  const toolCalls = message?.tool_calls || [];

  addCandidate(message?.content, 'choices[0].message.content');
  addCandidate(data?.choices?.[0]?.text, 'choices[0].text');
  addCandidate(data?.message?.content, 'message.content');
  addCandidate(data?.output_text, 'output_text');
  addCandidate(data?.content, 'content');
  addCandidate(data?.result, 'result');
  addCandidate(data?.response, 'response');
  addCandidate(data?.responses, 'responses');
  addCandidate(data, 'top-level response');

  toolCalls.forEach((toolCall, index) => {
    addCandidate(toolCall?.function?.arguments, `tool_calls[${index}].function.arguments`);
  });

  return candidates;
}

function parseStructuredResponse(data) {
  const candidates = extractCandidatePayloads(data);

  for (const candidate of candidates) {
    if (Array.isArray(candidate.value)) {
      const textValue = contentToText(candidate.value);
      const parsedArrayText = tryParseJson(textValue);
      if (parsedArrayText) {
        return parsedArrayText;
      }

      if (candidate.label === 'responses' || candidate.label === 'top-level response') {
        return { responses: candidate.value };
      }
    }

    if (candidate.value && typeof candidate.value === 'object') {
      if (Array.isArray(candidate.value.responses)) {
        return candidate.value;
      }

      if (candidate.label === 'responses') {
        return { responses: candidate.value };
      }
    }

    const textValue = contentToText(candidate.value);
    const parsedText = tryParseJson(textValue);
    if (parsedText) {
      return parsedText;
    }
  }

  return null;
}

function normalizeParsedResponse(parsedResponse) {
  if (Array.isArray(parsedResponse)) {
    return { responses: parsedResponse };
  }

  if (!parsedResponse || typeof parsedResponse !== 'object') {
    return parsedResponse;
  }

  if (Array.isArray(parsedResponse.data)) {
    return { responses: parsedResponse.data };
  }

  if (Array.isArray(parsedResponse.items)) {
    return { responses: parsedResponse.items };
  }

  const responsesValue = parsedResponse.responses;
  if (typeof responsesValue === 'string') {
    const parsedResponses = tryParseJson(responsesValue);

    if (Array.isArray(parsedResponses)) {
      return { ...parsedResponse, responses: parsedResponses };
    }

    if (parsedResponses && Array.isArray(parsedResponses.responses)) {
      return { ...parsedResponse, responses: parsedResponses.responses };
    }
  }

  return parsedResponse;
}

function normalizeResponseRow(prompt, existing) {
  return {
    prompt,
    response: String(existing?.response || existing?.answer || existing?.value || 'Not found'),
    source: String(existing?.source || existing?.evidence || existing?.quote || 'Not found'),
    page: String(existing?.page || existing?.pageNumber || existing?.location || 'N/A')
  };
}

/**
 * Call LLM API with structured JSON request and response
 * @param {string} endpoint - API endpoint URL
 * @param {string} apiKey - API key
 * @param {string} model - Model name to use
 * @param {Array<string>} prompts - Array of prompts
 * @param {Object} content - Content object with type and data
 * @param {number|null} contextWindow - Optional context window size
 * @returns {Promise<Object>} - Structured response
 */
export async function callLLMAPI(endpoint, apiKey, model, prompts, content, contextWindow = null) {
  try {
    const systemMessage = `You are a data extraction assistant for systematic reviews and meta-analysis.
Extract the requested information from the provided document.
Be accurate and concise.
Use "Not found" when evidence is not present.`;

    let documentSection = '';
    if (content.type === 'text') {
      documentSection = `Document Text:\n${content.data}\n\n`;
    } else if (content.type === 'pdf') {
      documentSection = `[PDF Document: ${content.fileName}]\n\n`;
    }

    const promptList = prompts
      .map((prompt, index) => `${index + 1}. ${prompt}`)
      .join('\n');

    const baseUserMessage = `${documentSection}Prompts to answer:\n${promptList}\n\nPlease extract the requested information and return it as a JSON object with the format specified.`;

    const messages = [
      { role: 'system', content: systemMessage },
      { role: 'user', content: baseUserMessage }
    ];

    const promptOnlyMessages = [
      { role: 'system', content: `${systemMessage}\n${RESPONSE_SHAPE_GUIDANCE}` },
      { role: 'user', content: `${baseUserMessage}\n\n${RESPONSE_SHAPE_GUIDANCE}` }
    ];

    const withOptionalMaxTokens = (body) => (
      contextWindow ? { ...body, max_tokens: contextWindow } : body
    );

    const structuredRequestBody = withOptionalMaxTokens({
      model,
      messages,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'extraction_result',
          strict: true,
          schema: responseSchema
        }
      },
      tools: [extractionTool]
    });

    const jsonModeRequestBody = withOptionalMaxTokens({
      model,
      messages,
      response_format: { type: 'json_object' }
    });

    const promptOnlyRequestBody = withOptionalMaxTokens({
      model,
      messages: promptOnlyMessages
    });

    const sendRequest = async (body, mode) => {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(body)
      });

      const rawText = await response.text();
      const payload = tryParseJson(rawText) || { rawText };
      return { response, payload, mode };
    };

    let requestResult = await sendRequest(structuredRequestBody, 'json_schema');

    if (!requestResult.response.ok) {
      const backendMessage = extractBackendErrorMessage(requestResult.payload);
      const shouldFallback =
        requestResult.response.status === 400 &&
        STRUCTURED_OUTPUT_UNSUPPORTED_PATTERN.test(backendMessage);

      if (shouldFallback) {
        console.warn('Structured output request unsupported. Retrying with json_object mode.');
        requestResult = await sendRequest(jsonModeRequestBody, 'json_object');

        if (!requestResult.response.ok) {
          const jsonModeMessage = extractBackendErrorMessage(requestResult.payload);
          const shouldUsePromptOnlyFallback =
            requestResult.response.status === 400 &&
            STRUCTURED_OUTPUT_UNSUPPORTED_PATTERN.test(jsonModeMessage);

          if (shouldUsePromptOnlyFallback) {
            console.warn('json_object mode unsupported. Retrying with prompt-only JSON instructions.');
            requestResult = await sendRequest(promptOnlyRequestBody, 'prompt_only');
          }
        }
      }
    }

    if (!requestResult.response.ok) {
      const backendMessage = extractBackendErrorMessage(requestResult.payload);
      const detail = backendMessage || `API request failed with status ${requestResult.response.status}`;
      throw new Error(`LLM request failed (${requestResult.mode}): ${detail}`);
    }

    let parsedResponse = normalizeParsedResponse(parseStructuredResponse(requestResult.payload));

    if (!parsedResponse) {
      console.error(
        'Failed to parse structured LLM output.',
        {
          mode: requestResult.mode,
          responseShape: summarizeResponseShape(requestResult.payload)
        }
      );
      throw new Error(`LLM returned an unparsable response in ${requestResult.mode} mode. Check the browser console for the raw response shape.`);
    }

    if (!Array.isArray(parsedResponse.responses)) {
      console.error(
        'LLM response JSON did not match the expected schema.',
        {
          mode: requestResult.mode,
          responseShape: summarizeResponseShape(requestResult.payload),
          parsedKeys: Object.keys(parsedResponse || {}).slice(0, 8)
        }
      );
      throw new Error(`LLM returned JSON, but not in the expected { responses: [...] } format (${requestResult.mode} mode).`);
    }

    parsedResponse.responses = prompts.map((prompt, index) => (
      normalizeResponseRow(prompt, parsedResponse.responses[index] || {})
    ));

    return parsedResponse;
  } catch (error) {
    console.error('API call error:', error);
    throw error;
  }
}

/**
 * Test API connection
 * @param {string} endpoint - API endpoint URL
 * @param {string} apiKey - API key
 * @param {string} model - Model name to use
 * @returns {Promise<boolean>} - True if connection successful
 */
export async function testAPIConnection(endpoint, apiKey, model) {
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: [{ role: 'user', content: 'test' }],
        max_tokens: 5
      })
    });

    return response.ok;
  } catch (error) {
    console.error('API test failed:', error);
    return false;
  }
}
