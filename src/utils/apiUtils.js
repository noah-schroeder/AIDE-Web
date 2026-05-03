const RESPONSE_ITEM_KEYS = ['prompt', 'response', 'source', 'page'];
const RESPONSE_ARRAY_KEYS = ['responses', 'results', 'answers', 'extractions', 'items', 'data'];

const FIELD_ALIASES = {
  prompt: ['prompt', 'question', 'field', 'label', 'name', 'item', 'column', 'header'],
  response: ['response', 'answer', 'result', 'value', 'extracted_value', 'extraction', 'text', 'content', 'output'],
  source: ['source', 'evidence', 'supporting_source', 'supporting_evidence', 'supporting_text', 'supportingText', 'quote', 'quotes', 'citation', 'context', 'rationale', 'reference'],
  page: ['page', 'pages', 'page_number', 'pageNumber', 'page_num', 'pageNum', 'page_range', 'location', 'locator']
};

const SYSTEM_MESSAGE = `You are a data extraction assistant for systematic reviews and meta-analysis.
Extract the requested information from the provided document.
Be accurate and concise.
Use "Not found" when evidence is not present.`;

function createResponseSchema(promptCount) {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      responses: {
        type: 'array',
        minItems: 1,
        maxItems: promptCount,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            prompt: {
              type: 'string',
              description: 'The prompt being answered.'
            },
            response: {
              type: 'string',
              description: 'The extracted answer, or Not found when the document does not provide evidence.'
            },
            source: {
              type: 'string',
              description: 'Short supporting source text from the document, or Not found.'
            },
            page: {
              type: 'string',
              description: 'The source page number or page range, or N/A.'
            }
          },
          required: RESPONSE_ITEM_KEYS
        }
      }
    },
    required: ['responses']
  };
}

function buildPromptText(prompts, content) {
  const documentIntro = content.type === 'text'
    ? `Document Text:\n${content.data}\n\n`
    : `PDF Document: ${content.fileName || 'uploaded document'}\nUse the attached PDF file as the source document.\n\n`;

  const promptList = prompts
    .map((prompt, index) => `${index + 1}. ${prompt}`)
    .join('\n');

  return `${documentIntro}Prompts to answer:\n${promptList}

Return only a JSON object in this exact shape, with one item per prompt in the same order:
{"responses":[{"prompt":"<prompt text>","response":"<answer or Not found>","source":"<supporting source text or Not found>","page":"<page number or N/A>"}]}
Do not include markdown, prose, reasoning, or thinking text in the final response content.`;
}

function extractBase64(value) {
  const str = String(value || '').trim();
  const match = str.match(/^data:[^;]+;base64,(.+)$/);
  return match ? match[1] : str;
}

function buildMessages(prompts, content) {
  const promptText = buildPromptText(prompts, content);

    if (content.type === 'pdf') {
    const base64Data = extractBase64(content.data);

    if (!base64Data) {
      throw new Error('PDF mode requires a base64-encoded PDF file.');
    }

    return [
      { role: 'system', content: SYSTEM_MESSAGE },
      {
        role: 'user',
        content: [
          { type: 'text', text: promptText },
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: base64Data
            }
          }
        ]
      }
    ];
  }

  const text = String(content.data || '').trim();
  if (!text) {
    throw new Error('Text-only mode requires extractable PDF text.');
  }

  return [
    { role: 'system', content: SYSTEM_MESSAGE },
    { role: 'user', content: promptText }
  ];
}

function createRequestBody({ model, messages, responseSchema, responseMode, contextWindow, omitThinking = false }) {
  const body = {
    model,
    messages,
    stream: false,
    response_format: responseMode === 'json_schema'
      ? {
          type: 'json_schema',
          json_schema: {
            name: 'extraction_result',
            strict: true,
            schema: responseSchema
          }
        }
      : { type: 'json_object' }
  };

  if (!omitThinking && isThinkingModel(model)) {
    body.thinking = { type: 'enabled', budget_tokens: 8000 };
    body.max_tokens = 16000;
  }

  return body;
}

async function sendRequest(endpoint, apiKey, body) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

function getErrorMessage(payload) {
  return (
    payload?.error?.message ||
    payload?.message ||
    payload?.detail ||
    ''
  );
}

function isThinkingParamUnsupportedError(message) {
  return (
    /(thinking|reasoning)[\s\S]*(unsupported|unknown|unrecognized|not supported|extra inputs?|forbidden|invalid)/i.test(message) ||
    /(unsupported|unknown|unrecognized|not supported|extra inputs?|forbidden|invalid)[\s\S]*(thinking|reasoning)/i.test(message)
  );
}

function isStructuredOutputUnsupportedError(message) {
  return (
    /(response_format|json_schema|structured output)[\s\S]*(unsupported|unknown|unrecognized|not supported|invalid request|extra inputs?|forbidden)/i.test(message) ||
    /(unsupported|unknown|unrecognized|not supported|invalid request|extra inputs?|forbidden)[\s\S]*(response_format|json_schema|structured output)/i.test(message) ||
    /output_config\.format\.schema[\s\S]*(not supported|unsupported)/i.test(message) ||
    /minItems.*not supported/i.test(message)
  );
}

function isSchemaValidationError(message) {
  return /(schema validation|json schema validation|jsonvalidator|failed validation|does not match.*schema|validating.*schema)/i.test(message);
}

function isPdfInputUnsupportedError(message) {
  return (
    /(pdf|file|document|multimodal|media|file_data|file_id|content array)[\s\S]*(unsupported|unknown|unrecognized|not supported|invalid|extra inputs?|forbidden)/i.test(message) ||
    /(unsupported|unknown|unrecognized|not supported|invalid|extra inputs?|forbidden)[\s\S]*(pdf|file|document|multimodal|media|file_data|file_id|content array)/i.test(message)
  );
}

function isThinkingModel(model) {
  return /thinking/i.test(String(model || ''));
}

async function sendCompletionMode({ endpoint, apiKey, model, messages, responseSchema, responseMode, contextWindow }) {
  const body = createRequestBody({ model, messages, responseSchema, responseMode, contextWindow });
  const result = await sendRequest(endpoint, apiKey, body);
  const message = getErrorMessage(result.payload);

  if (result.response.status === 400 && isThinkingParamUnsupportedError(message)) {
    console.warn('Thinking parameter unsupported for this route. Retrying without thinking.');
    const retryBody = createRequestBody({
      model,
      messages,
      responseSchema,
      responseMode,
      contextWindow,
      omitThinking: true
    });
    return sendRequest(endpoint, apiKey, retryBody);
  }

  return result;
}

function hasTextFallback(content) {
  return content.type === 'pdf' && String(content.textFallback || '').trim().length > 0;
}

function createTextFallbackContent(content) {
  return {
    type: 'text',
    data: content.textFallback,
    source: 'pdf-text-fallback',
    fileName: content.fileName
  };
}

async function sendWithPdfFallback(requestConfig, content, responseMode) {
  let activeContent = content;
  let messages = buildMessages(requestConfig.prompts, activeContent);
  let result = await sendCompletionMode({
    ...requestConfig,
    messages,
    responseMode
  });

  if (
    !result.response.ok &&
    result.response.status === 400 &&
    hasTextFallback(activeContent) &&
    isPdfInputUnsupportedError(getErrorMessage(result.payload))
  ) {
    console.warn('PDF input unsupported for this model or LiteLLM route. Retrying with extracted text.');
    activeContent = createTextFallbackContent(activeContent);
    messages = buildMessages(requestConfig.prompts, activeContent);
    result = await sendCompletionMode({
      ...requestConfig,
      messages,
      responseMode
    });
  }

  return { ...result, content: activeContent };
}

function messageContentToText(value) {
  if (typeof value === 'string') {
    return value.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').trim();
  }

  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (typeof part === 'string') {
          return part;
        }

        if (typeof part?.text === 'string') {
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

  return '';
}

function parseJsonText(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    return null;
  }

  try {
    return JSON.parse(rawText.trim());
  } catch {
    return null;
  }
}

function findBalancedJsonSnippets(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    return [];
  }

  const snippets = [];
  const seen = new Set();
  const closeFor = { '{': '}', '[': ']' };

  for (let start = 0; start < rawText.length; start += 1) {
    const firstChar = rawText[start];
    if (!closeFor[firstChar]) {
      continue;
    }

    const expectedClosers = [closeFor[firstChar]];
    let inString = false;
    let escaped = false;

    for (let index = start + 1; index < rawText.length; index += 1) {
      const char = rawText[index];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
        continue;
      }

      if (closeFor[char]) {
        expectedClosers.push(closeFor[char]);
        continue;
      }

      if (char === expectedClosers[expectedClosers.length - 1]) {
        expectedClosers.pop();

        if (expectedClosers.length === 0) {
          const snippet = rawText.slice(start, index + 1).trim();
          if (!seen.has(snippet)) {
            seen.add(snippet);
            snippets.push(snippet);
          }
          break;
        }
      }
    }
  }

  return snippets;
}

function parseJsonCandidates(value) {
  if (value && typeof value === 'object') {
    return [value];
  }

  if (typeof value !== 'string') {
    return [];
  }

  const candidateTexts = [];
  const seenTexts = new Set();
  const addCandidateText = (text) => {
    const trimmed = text?.trim();
    if (!trimmed || seenTexts.has(trimmed)) {
      return;
    }
    seenTexts.add(trimmed);
    candidateTexts.push(trimmed);
  };

  addCandidateText(value);

  const fullFenceMatch = value.trim().match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  if (fullFenceMatch) {
    addCandidateText(fullFenceMatch[1]);
  }

  const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let fenceMatch;
  while ((fenceMatch = fenceRegex.exec(value)) !== null) {
    addCandidateText(fenceMatch[1]);
  }

  findBalancedJsonSnippets(value).forEach(addCandidateText);

  return candidateTexts
    .map(parseJsonText)
    .filter((candidate) => candidate !== null);
}

function keyToken(value) {
  return String(value).toLowerCase().replace(/[\s_-]/g, '');
}

function promptToken(value) {
  return String(value).trim().toLowerCase();
}

function getField(entry, keys) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return undefined;
  }

  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(entry, key)) {
      return entry[key];
    }
  }

  const entryKeys = Object.keys(entry);
  for (const key of keys) {
    const matchingKey = entryKeys.find((entryKey) => keyToken(entryKey) === keyToken(key));
    if (matchingKey) {
      return entry[matchingKey];
    }
  }

  return undefined;
}

function stringifyExtractionValue(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  if (Array.isArray(value)) {
    const joined = value
      .map((item) => stringifyExtractionValue(item, ''))
      .filter(Boolean)
      .join('; ');
    return joined || fallback;
  }

  if (typeof value === 'object') {
    const nestedText = getField(value, ['text', 'content', 'quote', 'value', 'response', 'answer']);
    if (nestedText !== undefined && nestedText !== value) {
      return stringifyExtractionValue(nestedText, fallback);
    }

    try {
      return JSON.stringify(value);
    } catch {
      return fallback;
    }
  }

  return String(value);
}

function isResponseLikeEntry(entry) {
  if (typeof entry === 'string') {
    return entry.trim().length > 0;
  }

  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return false;
  }

  return Object.values(FIELD_ALIASES).some((aliases) => getField(entry, aliases) !== undefined);
}

function normalizeEntry(entry, prompt, index) {
  if (typeof entry === 'string') {
    return {
      prompt,
      response: entry,
      source: 'Not found',
      page: 'N/A'
    };
  }

  if (!entry || typeof entry !== 'object') {
    return {
      prompt,
      response: 'Not found',
      source: 'Not found',
      page: 'N/A'
    };
  }

  return {
    prompt: stringifyExtractionValue(getField(entry, FIELD_ALIASES.prompt), prompt || `Prompt ${index + 1}`),
    response: stringifyExtractionValue(getField(entry, FIELD_ALIASES.response), 'Not found'),
    source: stringifyExtractionValue(getField(entry, FIELD_ALIASES.source), 'Not found'),
    page: stringifyExtractionValue(getField(entry, FIELD_ALIASES.page), 'N/A')
  };
}

function buildNormalizedResponse(items, prompts) {
  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }

  const normalizedItems = items.map((item, index) => normalizeEntry(item, prompts[index] || '', index));
  const itemsByPrompt = new Map();

  normalizedItems.forEach((item) => {
    if (item.prompt) {
      itemsByPrompt.set(promptToken(item.prompt), item);
    }
  });

  return {
    responses: prompts.map((prompt, index) => {
      const matchingItem = itemsByPrompt.get(promptToken(prompt)) || normalizedItems[index] || {};
      return {
        prompt,
        response: matchingItem.response || 'Not found',
        source: matchingItem.source || 'Not found',
        page: matchingItem.page || 'N/A'
      };
    })
  };
}

function promptMappedItems(value, prompts) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const entries = Object.entries(value);
  const items = prompts.map((prompt) => {
    const matchingEntry = entries.find(([key]) => promptToken(key) === promptToken(prompt));

    if (!matchingEntry) {
      return null;
    }

    const [, mappedValue] = matchingEntry;
    if (mappedValue && typeof mappedValue === 'object' && !Array.isArray(mappedValue)) {
      return { prompt, ...mappedValue };
    }

    return { prompt, response: mappedValue };
  });

  return items.some(Boolean) ? items : null;
}

function objectValuesLookLikeResponses(value) {
  const entries = Object.entries(value || {});
  return entries.length > 0 && entries.some(([key, entry]) => {
    if (typeof entry === 'string') {
      return /^(?:prompt|question|field|item|column|header)?\d+$/i.test(keyToken(key));
    }

    return isResponseLikeEntry(entry);
  });
}

function normalizeResponsePayload(payload, prompts) {
  if (!payload) {
    return null;
  }

  if (Array.isArray(payload)) {
    return buildNormalizedResponse(payload, prompts);
  }

  if (typeof payload !== 'object') {
    return null;
  }

  for (const key of RESPONSE_ARRAY_KEYS) {
    const value = getField(payload, [key]);
    const parsedValue = typeof value === 'string'
      ? parseJsonCandidates(value)[0]
      : value;

    if (Array.isArray(parsedValue)) {
      return buildNormalizedResponse(parsedValue, prompts);
    }

    if (parsedValue && typeof parsedValue === 'object') {
      const nestedResponse = normalizeResponsePayload(parsedValue, prompts);
      if (nestedResponse) {
        return nestedResponse;
      }

      const mappedItems = promptMappedItems(parsedValue, prompts);
      if (mappedItems) {
        return buildNormalizedResponse(mappedItems, prompts);
      }

      if (objectValuesLookLikeResponses(parsedValue)) {
        return buildNormalizedResponse(Object.values(parsedValue), prompts);
      }
    }
  }

  if (isResponseLikeEntry(payload)) {
    return buildNormalizedResponse([payload], prompts);
  }

  const mappedItems = promptMappedItems(payload, prompts);
  if (mappedItems) {
    return buildNormalizedResponse(mappedItems, prompts);
  }

  if (objectValuesLookLikeResponses(payload)) {
    return buildNormalizedResponse(Object.values(payload), prompts);
  }

  return null;
}

function validateExtractionSchema(value, prompts) {
  const errors = [];

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push('Top-level response must be an object.');
    return { valid: false, errors };
  }

  Object.keys(value).forEach((key) => {
    if (key !== 'responses') {
      errors.push(`Unexpected top-level property "${key}".`);
    }
  });

  if (!Array.isArray(value.responses)) {
    errors.push('Property "responses" must be an array.');
    return { valid: false, errors };
  }

  if (value.responses.length !== prompts.length) {
    errors.push(`Expected ${prompts.length} response item(s), received ${value.responses.length}.`);
  }

  value.responses.forEach((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      errors.push(`responses[${index}] must be an object.`);
      return;
    }

    Object.keys(item).forEach((key) => {
      if (!RESPONSE_ITEM_KEYS.includes(key)) {
        errors.push(`Unexpected property "responses[${index}].${key}".`);
      }
    });

    RESPONSE_ITEM_KEYS.forEach((key) => {
      if (!Object.prototype.hasOwnProperty.call(item, key)) {
        errors.push(`Missing required property "responses[${index}].${key}".`);
      } else if (typeof item[key] !== 'string') {
        errors.push(`Property "responses[${index}].${key}" must be a string.`);
      }
    });
  });

  return { valid: errors.length === 0, errors };
}

function enforcePromptOrder(value, prompts) {
  return {
    responses: prompts.map((prompt, index) => ({
      ...value.responses[index],
      prompt
    }))
  };
}

function scoreResponse(value) {
  if (!value?.responses) {
    return Number.NEGATIVE_INFINITY;
  }

  return value.responses.reduce((score, item) => {
    const values = [item.response, item.source, item.page].map((part) => String(part || '').trim());

    values.forEach((part) => {
      if (!part) {
        return;
      }

      if (/<[^>]+>/.test(part)) {
        score -= 20;
      } else if (part !== 'Not found' && part !== 'N/A') {
        score += 2;
      }
    });

    return score;
  }, 0);
}

function describeResponseShape(responsePayload) {
  const firstChoice = responsePayload?.choices?.[0] || {};
  const firstMessage = firstChoice.message || {};
  return {
    topLevelKeys: Object.keys(responsePayload || {}),
    hasChoicesArray: Array.isArray(responsePayload?.choices),
    choiceKeys: Object.keys(firstChoice),
    messageKeys: Object.keys(firstMessage),
    hasToolCalls: Array.isArray(firstMessage.tool_calls) && firstMessage.tool_calls.length > 0,
    hasReasoningContent: typeof firstMessage.reasoning_content === 'string' && firstMessage.reasoning_content.length > 0,
    hasThinkingBlocks: Array.isArray(firstMessage.thinking_blocks) && firstMessage.thinking_blocks.length > 0,
    contentType: Array.isArray(firstMessage.content) ? 'array' : typeof firstMessage.content
  };
}

function collectStructuredCandidates(message) {
  const candidates = [];
  const addCandidates = (value) => {
    candidates.push(...parseJsonCandidates(value));
  };

  addCandidates(messageContentToText(message.content));

  if (Array.isArray(message.content)) {
    message.content.forEach((part) => {
      addCandidates(part?.input || part?.tool_input || part?.arguments);
    });
  }

  (message.tool_calls || []).forEach((toolCall) => {
    addCandidates(toolCall?.function?.arguments || toolCall?.input || toolCall?.arguments);
  });

  return candidates;
}

function parseStructuredResponse(data, prompts, responseMode) {
  const message = data.choices?.[0]?.message || {};
  const candidates = collectStructuredCandidates(message);
  let parsedResponse = null;
  let bestResponseScore = Number.NEGATIVE_INFINITY;
  let schemaValidationErrors = [];

  candidates.forEach((candidate) => {
    const strictValidation = validateExtractionSchema(candidate, prompts);
    if (strictValidation.valid) {
      const strictCandidate = enforcePromptOrder(candidate, prompts);
      const candidateScore = scoreResponse(strictCandidate) + 1000;
      if (!parsedResponse || candidateScore > bestResponseScore) {
        parsedResponse = strictCandidate;
        bestResponseScore = candidateScore;
      }
      return;
    }

    schemaValidationErrors = strictValidation.errors;

    if (responseMode === 'json_schema') {
      return;
    }

    const normalizedCandidate = normalizeResponsePayload(candidate, prompts);
    const normalizedValidation = validateExtractionSchema(normalizedCandidate, prompts);
    if (!normalizedValidation.valid) {
      schemaValidationErrors = normalizedValidation.errors;
      return;
    }

    const schemaCandidate = enforcePromptOrder(normalizedCandidate, prompts);
    const candidateScore = scoreResponse(schemaCandidate);
    if (!parsedResponse || candidateScore > bestResponseScore) {
      parsedResponse = schemaCandidate;
      bestResponseScore = candidateScore;
    }
  });

  if (!parsedResponse) {
    console.error('Failed to parse or validate structured LLM output.', {
      mode: responseMode,
      responseShape: describeResponseShape(data),
      schemaValidationErrors,
      content: message.content,
      toolCalls: message.tool_calls || []
    });

    throw new Error(
      candidates.length > 0
        ? `LLM returned JSON that failed schema validation in ${responseMode} mode. Check the browser console for validation errors.`
        : `LLM returned an unparsable response in ${responseMode} mode. Check the browser console for the raw response shape.`
    );
  }

  const finalValidation = validateExtractionSchema(parsedResponse, prompts);
  if (!finalValidation.valid) {
    console.error('LLM response JSON did not match the expected schema.', {
      mode: responseMode,
      parsedResponse,
      schemaValidationErrors: finalValidation.errors,
      responseShape: describeResponseShape(data)
    });
    throw new Error(`LLM returned JSON, but not in the expected { responses: [...] } format (${responseMode} mode).`);
  }

  return parsedResponse;
}

function validateCallInputs(endpoint, apiKey, model, prompts, content) {
  if (!String(endpoint || '').trim()) {
    throw new Error('API endpoint is required.');
  }

  if (!String(apiKey || '').trim()) {
    throw new Error('API key is required.');
  }

  if (!String(model || '').trim()) {
    throw new Error('Model is required.');
  }

  if (!Array.isArray(prompts) || prompts.length === 0) {
    throw new Error('At least one coding prompt is required.');
  }

  if (!content || !['text', 'pdf'].includes(content.type)) {
    throw new Error('Content must be either text or pdf.');
  }
}

/**
 * Call a LiteLLM/OpenAI-compatible chat completions endpoint and return validated extraction results.
 * Text mode sends extracted PDF text directly. PDF mode sends a base64 PDF file block and can
 * fall back to extracted text when the selected model or LiteLLM route does not support PDF input.
 */
export async function callLLMAPI(endpoint, apiKey, model, prompts, content, contextWindow = null) {
  try {
    validateCallInputs(endpoint, apiKey, model, prompts, content);

    const requestConfig = {
      endpoint: endpoint.trim(),
      apiKey,
      model,
      prompts,
      responseSchema: createResponseSchema(prompts.length),
      contextWindow
    };

    let responseMode = 'json_schema';
    let { response, payload: data, content: activeContent } = await sendWithPdfFallback(
      requestConfig,
      content,
      responseMode
    );

    if (!response.ok) {
      const message = getErrorMessage(data);
      const shouldFallbackToJsonObject =
        response.status === 400 &&
        !isSchemaValidationError(message) &&
        isStructuredOutputUnsupportedError(message);

      if (shouldFallbackToJsonObject) {
        console.warn('Structured output request unsupported. Retrying with json_object mode.');
        responseMode = 'json_object';
        ({ response, payload: data, content: activeContent } = await sendWithPdfFallback(
          requestConfig,
          activeContent,
          responseMode
        ));
      }
    }

    if (!response.ok) {
      throw new Error(
        getErrorMessage(data) ||
        `API request failed with status ${response.status}`
      );
    }

    try {
      return parseStructuredResponse(data, prompts, responseMode);
    } catch (parseError) {
      if (activeContent.type === 'pdf' && hasTextFallback(activeContent)) {
        console.warn('PDF mode returned unparsable response. Retrying with extracted text.');
        const textContent = createTextFallbackContent(activeContent);
        const textMessages = buildMessages(requestConfig.prompts, textContent);
        const { response: textResponse, payload: textData } = await sendCompletionMode({
          ...requestConfig,
          messages: textMessages,
          responseMode
        });
        if (!textResponse.ok) {
          throw new Error(getErrorMessage(textData) || `API request failed with status ${textResponse.status}`);
        }
        return parseStructuredResponse(textData, prompts, responseMode);
      }
      throw parseError;
    }
  } catch (error) {
    console.error('API call error:', error);
    throw error;
  }
}
