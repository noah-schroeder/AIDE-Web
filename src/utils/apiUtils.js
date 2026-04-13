const STRUCTURED_OUTPUT_UNSUPPORTED_PATTERN = /(json_schema|response_format|tools?|tool_choice|unsupported|unknown|invalid.+schema)/i;

const RESPONSE_SHAPE_GUIDANCE = `Return valid JSON only with this exact shape:
{
  "responses": [
    {
      "prompt": "<coding form field>",
      "response": "<extracted answer or Not found>",
      "source": "<verbatim quote from the document supporting your answer, or Not found>",
      "page": "<page number where found, or N/A>"
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
    // If it looks like HTML, return a generic message
    if (payload.trimStart().startsWith('<')) {
      return 'The API returned an error page. Check the endpoint URL.';
    }
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
    const raw = payload.rawText.trim();
    if (raw.startsWith('<')) {
      return 'The API returned an error page. Check the endpoint URL.';
    }
    return raw;
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

  // Prioritize tool_calls over message.content — when providers return structured
  // data via function calling, content is often null or a non-JSON acknowledgment.
  toolCalls.forEach((toolCall, index) => {
    addCandidate(toolCall?.function?.arguments, `tool_calls[${index}].function.arguments`);
  });

  addCandidate(message?.content, 'choices[0].message.content');
  addCandidate(data?.choices?.[0]?.text, 'choices[0].text');
  addCandidate(data?.message?.content, 'message.content');
  addCandidate(data?.output_text, 'output_text');
  addCandidate(data?.content, 'content');
  addCandidate(data?.result, 'result');
  addCandidate(data?.response, 'response');
  addCandidate(data?.responses, 'responses');
  addCandidate(data, 'top-level response');

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

function looksLikeResponseRow(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  const keys = Object.keys(obj);
  const answerKeys = ['response', 'answer', 'value', 'result', 'text', 'extracted_value'];
  const contextKeys = ['prompt', 'question', 'source', 'evidence', 'quote', 'page', 'page_number'];
  const hasAnswer = answerKeys.some((k) => keys.includes(k));
  const hasContext = contextKeys.some((k) => keys.includes(k));
  return hasAnswer && hasContext;
}

function findNestedResponseArray(obj, depth = 0) {
  if (depth > 2 || !obj || typeof obj !== 'object') return null;
  if (Array.isArray(obj)) {
    if (obj.length > 0 && looksLikeResponseRow(obj[0])) return obj;
    return null;
  }
  for (const value of Object.values(obj)) {
    if (Array.isArray(value) && value.length > 0 && looksLikeResponseRow(value[0])) {
      return value;
    }
  }
  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const found = findNestedResponseArray(value, depth + 1);
      if (found) return found;
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

  const alternateKeys = ['results', 'answers', 'output', 'extracted_data', 'extractions'];
  for (const key of alternateKeys) {
    if (Array.isArray(parsedResponse[key])) {
      return { responses: parsedResponse[key] };
    }
  }

  // Detect single unwrapped response object
  if (looksLikeResponseRow(parsedResponse)) {
    return { responses: [parsedResponse] };
  }

  // Deep-scan fallback: search nested objects for response-shaped arrays
  const nestedArray = findNestedResponseArray(parsedResponse);
  if (nestedArray) {
    return { responses: nestedArray };
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
    response: String(existing?.response ?? existing?.answer ?? existing?.value ?? existing?.result ?? existing?.extracted_value ?? existing?.text ?? 'Not found'),
    source: String(existing?.source ?? existing?.evidence ?? existing?.quote ?? existing?.supporting_text ?? existing?.excerpt ?? existing?.citation ?? 'Not found'),
    page: String(existing?.page ?? existing?.pageNumber ?? existing?.page_number ?? existing?.page_num ?? existing?.location ?? 'N/A')
  };
}

const MAX_RETRIES = 3;
const MAX_BACKOFF_MS = 30000;
const REQUEST_TIMEOUT_MS = 120000;

function isRetryableStatus(status) {
  return status === 429 || (status >= 500 && status <= 599);
}

function getBackoffDelay(attempt) {
  const base = Math.min(1000 * Math.pow(2, attempt), MAX_BACKOFF_MS);
  const jitter = base * (0.8 + Math.random() * 0.4);
  return Math.round(jitter);
}

function parseRetryAfter(headerValue) {
  if (!headerValue) return null;
  const seconds = Number(headerValue);
  if (!Number.isNaN(seconds) && seconds > 0) return seconds * 1000;
  const dateMs = Date.parse(headerValue);
  if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now());
  return null;
}

async function fetchWithTimeout(url, options, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)} seconds`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

const DEFAULT_CONTEXT_BUDGET = 8192;
const OVERHEAD_PER_PROMPT_TOKENS = 100;
const SYSTEM_OVERHEAD_TOKENS = 200;

function estimateTokenCount(text) {
  return text ? Math.ceil(text.length / 4) : 0;
}

function splitTextIntoChunks(fullText, maxTokensPerChunk) {
  const pagePattern = /\n--- Page \d+ ---\n/;
  const pages = fullText.split(pagePattern).filter((p) => p.trim());

  if (pages.length <= 1) return [fullText];

  // Reconstruct page markers from the original text
  const pageMarkers = fullText.match(/\n--- Page \d+ ---\n/g) || [];

  const chunks = [];
  let currentChunk = '';
  let currentTokens = 0;

  for (let i = 0; i < pages.length; i++) {
    const marker = pageMarkers[i] || `\n--- Page ${i + 1} ---\n`;
    const pageWithMarker = marker + pages[i];
    const pageTokens = estimateTokenCount(pageWithMarker);

    if (currentChunk && currentTokens + pageTokens > maxTokensPerChunk) {
      chunks.push(currentChunk);
      currentChunk = pageWithMarker;
      currentTokens = pageTokens;
    } else {
      currentChunk += pageWithMarker;
      currentTokens += pageTokens;
    }
  }

  if (currentChunk) chunks.push(currentChunk);
  return chunks;
}

function mergeChunkedResponses(chunkResults, prompts) {
  return prompts.map((prompt, index) => {
    for (const result of chunkResults) {
      const row = result.responses[index];
      if (row && row.response !== 'Not found') {
        return row;
      }
    }
    return chunkResults[0]?.responses[index] || {
      prompt,
      response: 'Not found',
      source: 'Not found',
      page: 'N/A'
    };
  });
}

/**
 * Call LLM API with structured JSON request and response
 * @param {string} endpoint - API endpoint URL
 * @param {string} apiKey - API key
 * @param {string} model - Model name to use
 * @param {Array<string>} prompts - Array of prompts
 * @param {Object} content - Content object with type and data
 * @param {number|null} contextWindow - Optional context window size
 * @param {Function|null} onProgress - Optional progress callback
 * @returns {Promise<Object>} - Structured response
 */
export async function callLLMAPI(endpoint, apiKey, model, prompts, content, contextWindow = null, onProgress = null) {
  try {
    // Auto-chunk large text content
    if (content.type === 'text') {
      const effectiveBudget = (contextWindow || DEFAULT_CONTEXT_BUDGET)
        - SYSTEM_OVERHEAD_TOKENS
        - estimateTokenCount(prompts.join('\n'))
        - (prompts.length * OVERHEAD_PER_PROMPT_TOKENS);

      const contentTokens = estimateTokenCount(content.data);
      if (contentTokens > effectiveBudget && effectiveBudget > 0) {
        const chunks = splitTextIntoChunks(content.data, effectiveBudget);
        if (chunks.length > 1) {
          const chunkResults = [];
          for (let i = 0; i < chunks.length; i++) {
            if (onProgress) onProgress(`Processing chunk ${i + 1} of ${chunks.length}...`);
            const chunkContent = { type: 'text', data: chunks[i] };
            const result = await callLLMAPI(endpoint, apiKey, model, prompts, chunkContent, contextWindow, onProgress);
            chunkResults.push(result);
          }
          return { responses: mergeChunkedResponses(chunkResults, prompts) };
        }
      }
    }

    const systemMessage = `You are a research data extraction assistant. Your task is to help researchers conduct systematic reviews and meta-analyses by extracting structured data from academic articles.

You will receive an academic document (research paper, journal article, or similar scholarly work) and a set of coding form fields. Each field is a question or data point that the researcher needs extracted from the document.

Instructions:
- Read the document carefully and answer each coding form field based solely on the document content.
- Be accurate, concise, and faithful to the source material.
- For each field, provide a direct verbatim quote from the document as supporting evidence.
- Identify the specific page number where the information was found.
- If a piece of information is not present in the document, respond with "Not found" — do not guess or infer beyond what is stated.`;

    const fieldGuidance = `For each coding form field, return:
- "response": Your concise answer extracted from the document.
- "source": A direct verbatim quote from the document that supports your answer. This must be actual text from the document — never a file name, file identifier, reference ID, or metadata.
- "page": The page number where this information appears (e.g. "1", "3", "12"). If it spans pages, return the first page. Use the page numbers as they appear in the document.`;

    let documentSection = '';
    let userContent;
    if (content.type === 'text') {
      documentSection = `Document Text:\n${content.data}\n\n`;
    } else if (content.type === 'pdf') {
      documentSection = '';
    }

    const promptList = prompts
      .map((prompt, index) => `${index + 1}. ${prompt}`)
      .join('\n');

    const promptSection = `${documentSection}${fieldGuidance}\n\nCoding form fields to extract:\n${promptList}\n\nExtract the requested data and return it as a JSON object with the format specified.`;

    if (content.type === 'pdf' && content.data) {
      const pdfTextParts = [
        {
          type: 'file',
          file: {
            filename: content.fileName,
            file_data: `data:application/pdf;base64,${content.data}`
          }
        },
        {
          type: 'text',
          text: `${fieldGuidance}\n\nCoding form fields to extract:\n${promptList}\n\nExtract the requested data and return it as a JSON object with the format specified. Remember: "source" must be a direct quote from the document text, never a file name or reference.`
        }
      ];

      // If we have extracted text with page markers, include a compact page index
      // so the model can cross-reference content locations with exact page numbers
      if (content.textFallback) {
        pdfTextParts.push({
          type: 'text',
          text: `Page reference index (use this to determine accurate page numbers):\n${content.textFallback}`
        });
      }

      userContent = pdfTextParts;
    } else {
      userContent = promptSection;
    }

    const baseUserMessage = promptSection;

    const messages = [
      { role: 'system', content: systemMessage },
      { role: 'user', content: userContent }
    ];

    // For prompt-only fallback, PDF binary can't be embedded — use text fallback
    const promptOnlyTextContent = content.type === 'pdf' && content.textFallback
      ? `Document Text:\n${content.textFallback}\n\n${fieldGuidance}\n\nCoding form fields to extract:\n${promptList}\n\nExtract the requested data and return it as a JSON object with the format specified.`
      : baseUserMessage;

    const promptOnlyMessages = [
      { role: 'system', content: `${systemMessage}\n${RESPONSE_SHAPE_GUIDANCE}` },
      { role: 'user', content: `${promptOnlyTextContent}\n\n${RESPONSE_SHAPE_GUIDANCE}` }
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
      }
    });

    const toolCallingRequestBody = withOptionalMaxTokens({
      model,
      messages,
      tools: [extractionTool],
      tool_choice: { type: 'function', function: { name: 'submit_extraction' } }
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
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const response = await fetchWithTimeout(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify(body)
          });

          if (isRetryableStatus(response.status) && attempt < MAX_RETRIES) {
            const retryAfter = parseRetryAfter(response.headers.get('Retry-After'));
            const delay = retryAfter ?? getBackoffDelay(attempt);
            console.warn(`Request returned ${response.status}. Retrying in ${Math.round(delay / 1000)}s (attempt ${attempt + 1}/${MAX_RETRIES})...`);
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          }

          const rawText = await response.text();
          const payload = tryParseJson(rawText) || { rawText };
          return { response, payload, mode };
        } catch (error) {
          if (attempt < MAX_RETRIES && error.message?.includes('timed out')) {
            const delay = getBackoffDelay(attempt);
            console.warn(`Request timed out. Retrying in ${Math.round(delay / 1000)}s (attempt ${attempt + 1}/${MAX_RETRIES})...`);
            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          }
          throw error;
        }
      }
      // Safety net: should be unreachable
      throw new Error('Request failed after all retry attempts');
    };

    let requestResult = await sendRequest(structuredRequestBody, 'json_schema');

    if (!requestResult.response.ok) {
      const backendMessage = extractBackendErrorMessage(requestResult.payload);
      const shouldFallback =
        requestResult.response.status === 400 &&
        STRUCTURED_OUTPUT_UNSUPPORTED_PATTERN.test(backendMessage);

      if (shouldFallback) {
        console.warn('Structured output request unsupported. Retrying with tool calling mode.');
        requestResult = await sendRequest(toolCallingRequestBody, 'tool_calling');

        if (!requestResult.response.ok) {
          const toolMessage = extractBackendErrorMessage(requestResult.payload);
          const shouldFallbackFromTools =
            requestResult.response.status === 400 &&
            STRUCTURED_OUTPUT_UNSUPPORTED_PATTERN.test(toolMessage);

          if (shouldFallbackFromTools) {
            console.warn('Tool calling mode unsupported. Retrying with json_object mode.');
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

    parsedResponse.responses = prompts.map((prompt, index) => {
      const row = parsedResponse.responses[index] || {};
      if (index >= parsedResponse.responses.length) {
        console.warn(`LLM returned only ${parsedResponse.responses.length} responses for ${prompts.length} prompts. Missing response for: "${prompt}"`);
      }
      return normalizeResponseRow(prompt, row);
    });

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
    const response = await fetchWithTimeout(endpoint, {
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
