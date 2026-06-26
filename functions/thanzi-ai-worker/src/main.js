const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'llama3-8b-8192';

export default async ({ req, res, log, error }) => {

  if (req.method === 'OPTIONS') return res.empty();

  if (req.method !== 'POST') {
    return res.json({ error: 'Method not allowed' }, 405);
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch (e) {
    return res.json({ error: 'Invalid JSON body' }, 400);
  }

  const { messages, model, temperature, max_tokens, system } = body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.json({ error: 'messages array is required' }, 400);
  }

  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_API_KEY) {
    error('GROQ_API_KEY not set');
    return res.json({ error: 'AI service not configured' }, 503);
  }

  const payload = {
    model: model || DEFAULT_MODEL,
    temperature: temperature ?? 0.7,
    max_tokens: max_tokens || 1024,
    messages: system
      ? [{ role: 'system', content: system }, ...messages]
      : messages,
  };

  try {
    log(`Groq call — model: ${payload.model}`);

    const groqRes = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await groqRes.json();

    if (!groqRes.ok) {
      error(`Groq error: ${JSON.stringify(data)}`);
      return res.json({ error: data?.error?.message || 'Groq error' }, groqRes.status);
    }

    return res.json({
      reply: data.choices[0].message.content,
      model: data.model,
      usage: data.usage,
    });

  } catch (e) {
    error(`Fetch failed: ${e.message}`);
    return res.json({ error: 'Failed to reach AI service' }, 502);
  }
};
