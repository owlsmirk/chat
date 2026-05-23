// Vercel serverless function: POST /api/chat
//
// Receives { system, messages } from the browser, forwards to Anthropic
// with the server-side API key, returns { text, usage } to the browser.

const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-sonnet-4-6';

// In-memory rate limit (per warm container).
// For real production, swap for Upstash Redis or similar.
const buckets = new Map();
function checkRate(ip) {
  const now = Date.now();
  const windowMs = 60_000;
  const limit = 20;
  const bucket = buckets.get(ip) || { count: 0, resetAt: now + windowMs };
  if (now > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + windowMs;
  }
  bucket.count += 1;
  buckets.set(ip, bucket);
  return bucket.count <= limit;
}

function setCors(res, origin) {
  // Allow-list of origins that can call this proxy.
  // Add your custom domain, claude.ai, etc.
  const allowed = (process.env.ALLOWED_ORIGINS || '*')
    .split(',').map(s => s.trim());

  if (allowed.includes('*')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (origin && allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function validate(body) {
  const { messages } = body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return 'messages array required';
  }
  if (messages.length > 50) return 'conversation too long';
  for (const m of messages) {
    if (!m.role || !m.content) return 'each message needs role and content';
    if (!['user', 'assistant'].includes(m.role)) return `invalid role: ${m.role}`;
    if (typeof m.content !== 'string' || m.content.length > 4000) {
      return 'message content must be string under 4000 chars';
    }
  }
  return null;
}

export default async function handler(req, res) {
  const origin = req.headers.origin;
  setCors(res, origin);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  // Auth
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY not configured');
    return res.status(500).json({ error: 'Server missing API key configuration' });
  }

  // Rate limit
  const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown')
    .split(',')[0].trim();
  if (!checkRate(ip)) {
    return res.status(429).json({ error: 'Too many requests, please slow down' });
  }

  // Validate
  const err = validate(req.body);
  if (err) return res.status(400).json({ error: err });

  // Forward — streaming SSE through to the client
  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION
      },
      body: JSON.stringify({
        model: process.env.CLAUDE_MODEL || DEFAULT_MODEL,
        max_tokens: 1024,
        system: req.body.system || undefined,
        messages: req.body.messages,
        stream: true
      })
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      console.error(`Anthropic ${upstream.status}: ${text}`);
      return res.status(upstream.status).json({
        error: 'Upstream error',
        status: upstream.status,
        detail: text.slice(0, 500)
      });
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value, { stream: true }));
    }
    res.end();
  } catch (e) {
    console.error('Proxy error:', e);
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Proxy failure', detail: e.message });
    }
    try { res.end(); } catch {}
  }
}
