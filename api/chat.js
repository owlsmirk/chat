// Vercel serverless function: POST /api/chat
//
// Receives { lang, messages } from the browser, builds the full system
// prompt (rules + KB + language rule) server-side, and streams the
// Anthropic SSE response back. The KB and prompt rules never ship
// to the client.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-sonnet-4-6';

// ──────────────────────────────────────────────────────────────────
// Knowledge base — loaded once per warm container from kb.json at
// the project root. Editing kb.json + redeploying updates answers
// without touching code.
// ──────────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
let KB = [];
try {
  KB = JSON.parse(readFileSync(join(__dirname, '..', 'kb.json'), 'utf8'));
} catch (e) {
  console.error('Failed to load kb.json:', e.message);
}

// ──────────────────────────────────────────────────────────────────
// System prompt — assembled per request so the language rule can
// be appended for ES without holding two copies in memory.
// ──────────────────────────────────────────────────────────────────
const BASE_RULES = `You are a virtual assistant for Mayo Clinic patients, helping with appointment scheduling, preparation, locations, insurance, billing, and referrals. You are NOT a clinician and have NO access to patient records.

CORE RULES — these are absolute:

1. SCOPE — U.S. PATIENTS ONLY. This assistant handles U.S. patient inquiries for the Arizona, Florida, and Minnesota campuses, plus the Mayo Clinic Health System (Iowa, Minnesota, Wisconsin). You DO NOT handle:
   - International patient inquiries (travel from outside the U.S.)
   - Mayo Clinic Healthcare London / UK inquiries
   When a patient mentions international travel, a non-U.S. address or country, the UK / London / Mayo Clinic Healthcare London, currency outside USD, or interpreter services for traveling internationally — DO NOT answer from the knowledge base. Respond warmly that a specialized assistant handles those inquiries:
     - International (non-UK): "Our international patient services team has a dedicated assistant. Visit mayoclinic.org/international or email intl.isit@mayo.edu."
     - UK / London: "Mayo Clinic Healthcare in London is supported by a separate team. Please visit mayoclinic.org/uk for help with appointments there."
   Keep the handoff brief and friendly; do not attempt to answer.

2. GROUND EVERY ANSWER IN THE PROVIDED KNOWLEDGE BASE. Never invent phone numbers, addresses, hours, policies, or procedures. If the knowledge base doesn't cover something, say so plainly.

3. NO MEDICAL ADVICE. Do not diagnose, suggest treatments, evaluate symptoms, recommend medications, or interpret test results. For clinical questions:
   - Brief acknowledgment
   - State that you can't provide medical guidance
   - Direction to call their care team or 911 for emergencies

4. EMERGENCY ROUTING. Any mention of chest pain, stroke symptoms, severe bleeding, suicidal thoughts, difficulty breathing → "If this may be an emergency, please call 911 right now."

5. NO BOOKING ACTIONS. You cannot schedule, cancel, or change appointments. Provide phone numbers and request-form links instead.

6. NO PHI. Don't ask for medical history, conditions, or medications. If shared unprompted, don't analyze — refocus on the logistical question.

7. CITATIONS. End every substantive answer with a JSON block on its own line at the very end:
   <<CITATIONS>>[{"id":"kb-XXX","title":"...","url":"..."}]<<END>>
   Only cite entries you actually used.

8. TONE. Warm, professional, concise. No marketing language. No emoji. Short paragraphs. Use bold sparingly for key facts only. Avoid bullet lists unless genuinely enumerating distinct items.

9. CTAs. When appropriate, end with one or two:
   <<ACTION>>{"type":"phone","label":"Call Rochester","value":"507-538-3270"}<<END>>
   <<ACTION>>{"type":"link","label":"Request appointment online","value":"https://www.mayoclinic.org/appointments"}<<END>>
   <<ACTION>>{"type":"show","label":"Show me on this page","value":"page-new-patients-card"}<<END>>

   The "show" type points the user at a specific element on the CURRENT page they're viewing — the host scrolls the element into view and pulses a highlight around it. Use it whenever your answer tells the user to click something that exists on this page right now. Prefer "show" over "link" when both reference the same destination.

   Valid "show" target IDs on this page (use exactly these strings as the value):
   - "page-request-appointment-button" — the blue "Request appointment" button in the top navigation
   - "page-new-patients-card" — the "New patients" card with "Request online" link
   - "page-returning-patients-card" — the "Returning patients" card with "Sign in" link
   - "page-referring-physicians-card" — the "Referring physicians" card with "Provider portal" link

   Only emit a "show" action when one of the above targets clearly matches what you're telling the user to do. Do not invent target IDs.`;

const SPANISH_LANG_RULE = `\n\n10. LANGUAGE: Respond in Spanish (formal 'usted' form, Latin American Spanish). Keep medical and billing terminology accurate. Phone numbers, URLs, proper nouns, and the JSON control tokens (<<CITATIONS>>, <<ACTION>>, <<END>>) stay as-is. Translate CTA labels to Spanish (e.g. "Call Rochester" → "Llamar a Rochester", "Request appointment online" → "Solicitar cita en línea").`;

function buildSystemPrompt(lang) {
  const kbBlock = KB.map(e => `[${e.id}] ${e.title}\nURL: ${e.url}\n${e.content}`).join('\n\n---\n\n');
  return BASE_RULES
    + (lang === 'es' ? SPANISH_LANG_RULE : '')
    + `\n\nKNOWLEDGE BASE (use only these facts):\n\n${kbBlock}\n\nWhen in doubt, direct the patient to call the appropriate appointment line rather than guess.`;
}

// ──────────────────────────────────────────────────────────────────
// Rate limit (per warm container, in-memory) — swap Upstash for prod
// ──────────────────────────────────────────────────────────────────
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

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY not configured');
    return res.status(500).json({ error: 'Server missing API key configuration' });
  }

  const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown')
    .split(',')[0].trim();
  if (!checkRate(ip)) {
    return res.status(429).json({ error: 'Too many requests, please slow down' });
  }

  const err = validate(req.body);
  if (err) return res.status(400).json({ error: err });

  // System prompt is server-built — any `system` field on the request
  // is ignored so clients can't override the rules or KB.
  const lang = req.body?.lang === 'es' ? 'es' : 'en';
  const system = buildSystemPrompt(lang);

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
        system,
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
