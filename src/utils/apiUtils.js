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
    // Build the system message
    const systemMessage = `You are a data extraction assistant for systematic reviews and meta-analysis. 
You will be given a document and multiple prompts. For each prompt, extract the relevant information from the document.

You MUST respond with a valid JSON object in the following format:
{
  "responses": [
    {
      "prompt": "<​the prompt text>",
      "response": "<​your extracted answer>",
      "source": "<​the exact text from the document that supports your answer>",
      "page": "<​page number if available, or 'N/A'>"
    }
  ]
}

IMPORTANT:
- Return ONLY the JSON object, no additional text
- Include ALL prompts in the responses array
- If information is not found for a prompt, use "Not found" as the response
- Extract verbatim source text when possible
- Be accurate and concise`;

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

    const requestBody = {
      model: model, // Use the model passed in directly
      messages: messages,
      temperature: 0.1, // Low temperature for consistent extraction
      response_format: { type: 'json_object' } // Request JSON response if supported
    };

    if (contextWindow) {
      requestBody.max_tokens = contextWindow;
    }

    // Make the API call
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.error?.message || 
        `API request failed with status ${response.status}`
      );
    }

    const data = await response.json();
    
    // Extract the response content
    const responseContent = data.choices?.[0]?.message?.content;
    
    if (!responseContent) {
      throw new Error('No response content from API');
    }

    // Parse the JSON response
    let parsedResponse;
    try {
      // Remove markdown code blocks if present
      const cleanedContent = responseContent
        .replace(/\`\`\`json\s*/g, '')
        .replace(/\`\`\`\s*/g, '')
        .trim();
      
      parsedResponse = JSON.parse(cleanedContent);
    } catch (parseError) {
      console.error('Failed to parse LLM response:', responseContent);
      throw new Error('LLM did not return valid JSON. Please try again.');
    }

    // Validate the response structure
    if (!parsedResponse.responses || !Array.isArray(parsedResponse.responses)) {
      throw new Error('Invalid response structure from LLM');
    }

    // Ensure all prompts have responses
    if (parsedResponse.responses.length !== prompts.length) {
      console.warn('Response count mismatch. Expected:', prompts.length, 'Got:', parsedResponse.responses.length);
    }

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