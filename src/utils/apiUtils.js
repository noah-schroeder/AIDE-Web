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

    // Keep instructions concise and rely on schema/tooling for structure.
    const systemMessage = `You are a data extraction assistant for systematic reviews and meta-analysis.
Extract the requested information from the provided document.
Be accurate and concise.
Use "Not found" when evidence is not present.`;

    // Build the user message with prompts
    let userMessage = '';
    
    if (content.type === 'text') {
      userMessage = `Document Text:\n${content.data}\n\n`;
    } else if (content.type === 'pdf') {
      userMessage = `[PDF Document: ${content.fileName}]\n\n`;
    }

    userMessage += `Prompts to answer:\n`;
    prompts.forEach((prompt, index) => {
      userMessage += `${index + 1}. ${prompt}\n`;
    });

    userMessage += `\nPlease extract the requested information and return it as a JSON object with the format specified.`;

    // Build the request
    const messages = [
      { role: 'system', content: systemMessage },
      { role: 'user', content: userMessage }
    ];

    // For PDF mode with vision-capable models, include the PDF
    if (content.type === 'pdf') {
      // Try to use vision API if available (e.g., GPT-4 Vision, Claude with images)
      // For now, we'll convert PDF to text as a fallback
      // You can extend this to handle base64 images for vision models
    }

    const structuredRequestBody = {
      model: model, // Use the model passed in directly
      messages: messages,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'extraction_result',
          strict: true,
          schema: responseSchema
        }
      },
      tools: [extractionTool]
    };

    if (contextWindow) {
      structuredRequestBody.max_tokens = contextWindow;
    }

    const fallbackRequestBody = {
      model,
      messages,
      response_format: { type: 'json_object' }
    };

    if (contextWindow) {
      fallbackRequestBody.max_tokens = contextWindow;
    }

    const sendRequest = async (body) => {
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
    };

    // Make structured call first, then retry with simpler JSON mode if unsupported.
    let { response, payload: data } = await sendRequest(structuredRequestBody);
    if (!response.ok) {
      const message = data?.error?.message || '';
      const shouldFallback =
        response.status === 400 &&
        /(json_schema|response_format|tools?|tool_choice|unsupported|unknown)/i.test(message);

      if (shouldFallback) {
        console.warn('Structured output request unsupported. Retrying with json_object mode.');
        const fallbackResult = await sendRequest(fallbackRequestBody);
        response = fallbackResult.response;
        data = fallbackResult.payload;
      }
    }

    if (!response.ok) {
      throw new Error(
        data?.error?.message ||
        `API request failed with status ${response.status}`
      );
    }

    console.log('Full API response:', data);
    
    // Extract structured output from either message.content or tool_calls.
    const message = data.choices?.[0]?.message || {};
    const toolCalls = message.tool_calls || [];
    console.log('Raw LLM message content:', message.content);
    console.log('Raw LLM tool calls:', toolCalls);

    const contentToText = (value) => {
      if (typeof value === 'string') {
        return value;
      }

      if (Array.isArray(value)) {
        return value
          .map((part) => {
            if (typeof part === 'string') {
              return part;
            }

            // OpenAI/Anthropic compatibility wrappers may return content blocks.
            if (part?.type === 'text' && typeof part?.text === 'string') {
              return part.text;
            }

            return '';
          })
          .join('')
          .trim();
      }

      return '';
    };

    const tryParseJson = (rawText) => {
      if (!rawText || typeof rawText !== 'string') {
        return null;
      }

      const cleanedText = rawText
        .replace(/\`\`\`json\s*/gi, '')
        .replace(/\`\`\`\s*/g, '')
        .trim();

      try {
        return JSON.parse(cleanedText);
      } catch {
        return null;
      }
    };

    let parsedResponse = null;

    // 1) Preferred: JSON in message.content (from response_format=json_schema or json_object)
    const contentText = contentToText(message.content);
    parsedResponse = tryParseJson(contentText);

    // 2) Fallback: JSON function arguments in tool_calls (common with Claude adapters)
    if (!parsedResponse && toolCalls.length > 0) {
      for (const toolCall of toolCalls) {
        const argsText = toolCall?.function?.arguments;
        const parsedArgs = tryParseJson(argsText);
        if (parsedArgs) {
          parsedResponse = parsedArgs;
          break;
        }
      }
    }

    if (!parsedResponse) {
      console.error('Failed to parse response. Content:', message.content, 'Tool calls:', toolCalls);
      throw new Error('LLM did not return parseable structured output. Please try again.');
    }

    // Normalize common provider variants before strict validation.
    if (Array.isArray(parsedResponse)) {
      parsedResponse = { responses: parsedResponse };
    }

    const responsesValue = parsedResponse?.responses;
    if (typeof responsesValue === 'string') {
      const parsedResponses = tryParseJson(responsesValue);

      if (Array.isArray(parsedResponses)) {
        parsedResponse.responses = parsedResponses;
      } else if (parsedResponses && Array.isArray(parsedResponses.responses)) {
        parsedResponse.responses = parsedResponses.responses;
      }
    }

    // Validate the response structure
    if (!parsedResponse.responses || !Array.isArray(parsedResponse.responses)) {
      throw new Error('Invalid response structure from LLM');
    }

    // Ensure all prompts have responses and required shape for downstream UI.
    parsedResponse.responses = prompts.map((prompt, index) => {
      const existing = parsedResponse.responses[index] || {};
      return {
        prompt,
        response: existing.response || 'Not found',
        source: existing.source || 'Not found',
        page: existing.page || 'N/A'
      };
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