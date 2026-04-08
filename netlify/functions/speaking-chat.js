/*
  Netlify Serverless Function — Speaking Chat Proxy
  Chama a API do Groq com segurança (a chave nunca vai para o frontend).

  Variável de ambiente necessária no painel do Netlify:
    GROQ_API_KEY = sua chave do Groq (https://console.groq.com)
*/

const https = require('https');

const DEFAULT_SYSTEM_PROMPT =
  'You are a friendly English conversation partner helping students practice spoken English. ' +
  'Keep responses natural, clear, and conversational — like a real person talking. ' +
  'Prefer short, flowing responses (2-4 sentences) to keep the dialogue moving. ' +
  'Never use bullet points or lists. Always respond in English only.';

exports.handler = async function (event) {
  /* CORS preflight */
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let message, history, systemOverride;
  try {
    const body = JSON.parse(event.body || '{}');
    message = (body.message || '').trim();
    history = Array.isArray(body.history) ? body.history.slice(-10) : [];
    systemOverride = typeof body.system === 'string' && body.system.trim()
      ? body.system.trim()
      : null;
  } catch (_) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  if (!message) {
    return { statusCode: 400, body: JSON.stringify({ error: 'message is required' }) };
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'API key not configured' }) };
  }

  /* Use frontend-supplied system prompt if provided, otherwise fall back to default */
  const systemContent = systemOverride || DEFAULT_SYSTEM_PROMPT;

  /* Report requests need more tokens than conversation turns */
  const isReport = systemOverride && systemOverride.includes('pedagogical report');
  const maxTokens = isReport ? 600 : 200;

  const messages = [
    { role: 'system', content: systemContent },
    ...history,
    { role: 'user', content: message },
  ];

  const payload = JSON.stringify({
    model: 'llama-3.1-8b-instant',
    messages,
    max_tokens: maxTokens,
    temperature: 0.8,
  });

  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: 'api.groq.com',
        path: '/openai/v1/chat/completions',
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + apiKey,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            const response = (json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content) || '';
            resolve({
              statusCode: 200,
              headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
              },
              body: JSON.stringify({ response }),
            });
          } catch (_) {
            resolve({ statusCode: 502, body: JSON.stringify({ error: 'Invalid response from AI' }) });
          }
        });
      }
    );
    req.on('error', () =>
      resolve({ statusCode: 502, body: JSON.stringify({ error: 'Connection to AI failed' }) })
    );
    req.write(payload);
    req.end();
  });
};
