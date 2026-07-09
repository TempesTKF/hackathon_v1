import { Readable } from 'node:stream';

function endpointOf(baseUrl) {
  const b = String(baseUrl || '').replace(/\/+$/, '');
  if (!b) return '';
  if (b.endsWith('/chat/completions')) return b;
  return `${b}/v1/chat/completions`;
}

function pickEnv(prefix = '') {
  const env = process.env;
  return {
    baseUrl: env[`${prefix}LLM_BASE_URL`] || env[`${prefix}VITE_LLM_BASE_URL`],
    apiKey: env[`${prefix}LLM_API_KEY`] || env[`${prefix}VITE_LLM_API_KEY`],
  };
}

async function proxyOnce(target, body) {
  const endpoint = endpointOf(target.baseUrl);
  if (!endpoint || !target.apiKey) {
    return new Response(JSON.stringify({ error: { message: 'Missing LLM_BASE_URL or LLM_API_KEY' } }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
  const payload = { ...body };
  if (process.env.LLM_MODEL && !payload.model) payload.model = process.env.LLM_MODEL;
  return fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${target.apiKey}`,
    },
    body: JSON.stringify(payload),
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: { message: 'Method Not Allowed' } });
    return;
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const wantsStream = body.stream === true;
    let upstream = await proxyOnce(pickEnv(), body);
    if (!upstream.ok && (process.env.LLM_FALLBACK_BASE_URL || process.env.VITE_LLM_FALLBACK_BASE_URL)) {
      upstream = await proxyOnce(pickEnv('FALLBACK_'), body);
    }

    const contentType = upstream.headers.get('content-type') || (wantsStream ? 'text/event-stream' : 'application/json');
    res.status(upstream.status);
    res.setHeader('content-type', contentType);
    res.setHeader('cache-control', 'no-cache, no-store, must-revalidate');

    if (!upstream.body) {
      res.end(await upstream.text());
      return;
    }
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (error) {
    res.status(500).json({ error: { message: error instanceof Error ? error.message : String(error) } });
  }
}

