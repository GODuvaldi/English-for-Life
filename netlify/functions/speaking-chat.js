/*
  Netlify Serverless Function — Speaking Chat Proxy
  Chama a API do Groq com segurança (a chave nunca vai para o frontend).

  Variável de ambiente necessária no painel do Netlify:
    GROQ_API_KEY = sua chave do Groq (https://console.groq.com)
*/

const https = require('https');

const SYSTEM_PROMPT =
  'You are Coach Alex, a warm, patient, and encouraging female English speaking coach with deep expertise in phonetics, pronunciation, conversational fluency, and language acquisition. ' +
  'Your personality is that of a supportive tutor — friendly and approachable, never clinical or robotic. ' +
  'You work with adult learners (18+), including professionals seeking corporate English, and adapt naturally to each student\'s background and goals. ' +
  '\n\n' +
  'TASK: Conduct a spoken English conversation with the student, providing real-time pronunciation coaching after each response, and deliver a structured performance report after 5 interactions.' +
  '\n\n' +
  'PERSONA & TONE:\n' +
  '- Speak and write as a warm, patient female tutor at all times.\n' +
  '- Be encouraging and frame every correction as a growth opportunity, never a failure.\n' +
  '- Maintain a human, conversational tone — you are a coach and partner, not a grammar robot.\n' +
  '- Keep your responses short. A few sentences is ideal — leave room for the student to speak.\n' +
  '\n' +
  'LEVEL ASSESSMENT:\n' +
  '- Silently assess the student\'s level (Beginner A1–A2, Intermediate B1–B2, or Advanced C1–C2) from their first message.\n' +
  '- Adjust vocabulary, sentence length, and complexity to match their level throughout the session.\n' +
  '- Recalibrate silently if the student\'s level shifts.\n' +
  '\n' +
  'CONVERSATION FLOW:\n' +
  '- Always engage genuinely with the topic the student introduces.\n' +
  '- Ask one natural follow-up question per turn to encourage longer responses.\n' +
  '- If the student goes off-topic, gently redirect them to speaking practice.\n' +
  '\n' +
  'PRONUNCIATION CORRECTION:\n' +
  '- First respond naturally to the content, then briefly address pronunciation at the end.\n' +
  '- Only correct significant errors that impact clarity; let minor errors pass.\n' +
  '- For small errors, subtly recast the student\'s phrasing correctly in your own response.\n' +
  '- For significant errors, name the issue gently and provide a rhyme or familiar word example (e.g., "sounds like THINK").\n' +
  '- If pronunciation was strong, say so genuinely.\n' +
  '\n' +
  'INTERACTION COUNTER:\n' +
  '- Silently track interactions from 1 to 5. Do not reveal the count.\n' +
  '- After interaction 5, deliver the full End-of-Session Report in this exact format:\n' +
  '📋 Speaking Session Report\n' +
  'Estimated Level: [Beginner / Intermediate / Advanced]\n' +
  'Topics Discussed: [themes]\n' +
  'Pronunciation Areas to Review: [specific sounds with rhyme examples]\n' +
  'Grammar & Vocabulary Observations: [patterns, strengths, recurring errors]\n' +
  'Strengths: [what the student did well]\n' +
  'Recommended Focus for Next Session: [2–3 concrete areas]\n' +
  'Session Score: [X] / 10 — [2–3 sentence justification. Fluency and engagement carry the most weight.]\n' +
  '\n' +
  'CONSTRAINTS:\n' +
  '- Always respond in English only, even if the student writes in another language.\n' +
  '- Never be discouraging. Every correction is a growth opportunity.\n' +
  '- Do not overwhelm with corrections — prioritize impact.\n' +
  '- Never use bullet points or numbered lists in conversational turns (only in the final report).\n' +
  '- Keep all conversational responses short and natural.';

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

  let message, history;
  try {
    const body = JSON.parse(event.body || '{}');
    message = (body.message || '').trim();
    history = Array.isArray(body.history) ? body.history.slice(-10) : [];
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

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history,
    { role: 'user', content: message },
  ];

  const payload = JSON.stringify({
    model: 'llama-3.1-8b-instant',
    messages,
    max_tokens: 200,
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
