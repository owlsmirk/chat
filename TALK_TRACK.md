# Talk Track — Mayo Scheduling Assistant

A reference for explaining the system to two audiences without
switching brains mid-sentence. Each step has an **executive
framing** (outcome, value, no jargon) and a **technical framing**
(implementation, contract, tradeoff). Pick the one your room
needs.

---

## The 30-second pitch

**For executives** — "A Mayo Clinic–branded chat assistant that
helps patients with appointments, billing, insurance, and
locations. Every answer cites mayoclinic.org. It speaks English
and Spanish, accepts voice, and can highlight things directly on
the page. Built on a single HTML file plus one serverless
function — deployable in ten minutes."

**For technical leaders** — "A static-HTML widget backed by a
stateless Vercel edge function that assembles a grounded system
prompt from a JSON knowledge base and streams Claude Sonnet 4.6
responses over SSE. KB is server-side and hot-reloadable; clients
can't override prompt or rules. Per-IP rate limit, zero npm
dependencies, language-aware end-to-end."

---

## How it works — five steps

Walk through these in order. Each step has two framings; the
underlying mechanism is the same.

### 1 · User opens the assistant

**Executive** — "The patient sees a Mayo-blue chat button in the
corner. Tapping it slides up the assistant. Four capability cards
appear — Appointments, Billing & Insurance, Locations, Patient
Portal — so the patient can start with a tap, or type, or speak.
The assistant identifies itself, makes the 911 disclaimer visible
at the top, and waits."

**Technical** — "Single HTML file, ~50 KB compressed, loads. No
build pipeline, no dependencies, no client-side knowledge base.
The widget is a slide-up panel on desktop and a full-screen
takeover on mobile. Capability cards render from a per-language
L10N table. Voice input is enabled only if `window.SpeechRecognition`
is present — Firefox falls back to text-only without the mic
showing."

### 2 · The patient asks a question

**Executive** — "They can type or speak, in English or Spanish.
Voice transcribes live as they talk. Toggling the language pill
flips every label, the voice locale, and the language Claude
responds in. Previous messages stay in the language they were
sent — we don't silently rewrite history."

**Technical** — "Web Speech API for input — browser-native, no
external transcription service. `recog.lang` flips between
`en-US` and `es-US` with the toggle. The composer assembles
`{ lang, messages }` as the request body. The system prompt,
knowledge base, and API key never leave the server — the browser
sends only conversation state and a language hint."

### 3 · The server builds the request

**Executive** — "A small server function in the middle does five
things: it checks the request is allowed, makes sure no one is
hammering the system, validates the shape, assembles the right
knowledge for the question, and adds the secure API key. Then it
calls Claude."

**Technical** — "Vercel serverless function, ~120 lines, zero
runtime dependencies. Pipeline:
1. **CORS** — origin allow-list from `ALLOWED_ORIGINS` env
2. **Rate limit** — 20 req / min / IP, in-memory bucket per warm
   container (swap Upstash Redis for production)
3. **Validate** — message array shape, ≤ 50 turns, ≤ 4000 chars
   per message, roles ∈ `{user, assistant}`
4. **Build prompt** — read `kb.json` (cached at module init),
   assemble `BASE_RULES + kb.json + SPANISH_LANG_RULE if lang=es`.
   Any client-supplied `system` field is ignored
5. **Stream** — POST to Anthropic with `x-api-key`, pass SSE
   bytes through with `Cache-Control: no-store`"

### 4 · Claude generates the answer

**Executive** — "Claude reads the question alongside our
knowledge base — 18 paraphrased entries we sourced from
mayoclinic.org — and writes an answer grounded only in those
sources. The rules forbid invention: if it doesn't know, it says
so. Every substantive answer cites the sources it used."

**Technical** — "Anthropic API call to `/v1/messages` with
`stream=true`. System prompt has 10 absolute rules:
KB-only-grounded, no medical advice, no booking, no PHI,
emergency routing, citation requirement, action-token protocol,
campus disambiguation, U.S.-only scope, plus the language rule
when active. Response shape: markdown text plus optional control
tokens — `<<CITATIONS>>[…]<<END>>` and `<<ACTION>>{type,
label, value}<<END>>` with three action types: `phone`, `link`,
`show`."

### 5 · The patient sees and acts

**Executive** — "The answer streams in word-by-word, with cited
sources, suggested follow-up questions, and tap-to-act buttons.
If the answer points to something on the page — like the New
Patients card — the page itself highlights it, instead of just
linking. The patient can also have the answer read aloud."

**Technical** — "SSE deltas append into the message bubble with
a blinking caret. When the stream closes, the client strips
control tokens and parses: citations become an inline chip and
an expandable Sources drawer; actions render as compact CTAs;
contextual follow-up chips are picked from the citation IDs.
`show` actions dismiss the widget, scroll the target into view,
and pulse a Mayo-blue ring around it — desktop and mobile —
with a return-to-chat pill. TTS is per-reply via
`SpeechSynthesisUtterance`, language-flipped, with a curated
voice preference per platform."

---

## Capabilities you should be able to name

Memorize these. They come up in every Q&A:

- **Grounded** — every assertion cites a `kb-XXX` source; the
  model is told to say "I don't know" rather than guess
- **Multilingual** — EN / ES toggle flips chrome, capability
  cards, follow-up suggestions, voice locale, and the language
  rule appended to the system prompt
- **Voice in + read-aloud** — Web Speech API for both directions,
  per-language, per platform
- **Page-aware** — the model can tell the page to scroll and
  pulse a specific element, instead of opening a new tab
- **Mobile-first** — full-screen takeover, scroll lock,
  safe-area aware
- **Trust-first** — 911 banner pinned, "AI can make mistakes"
  disclaimer, no PHI handling, citation enforcement
- **Self-service editing** — KB is `kb.json`; edit, commit,
  redeploy, no client-side cache to bust

---

## Memorable numbers

| | |
|---|---|
| HTML files | 1 |
| Serverless functions | 1 |
| npm dependencies | 0 |
| KB entries | 18 |
| Languages | 2 |
| U.S. campuses | 3 |
| In-page targets the bot can highlight | 4 |
| Server pipeline steps | 5 |
| Per-IP rate limit | 20 / min |
| Deploy time, cold | ~ 10 minutes |
| First token | ~ 400 ms |
| Full reply | 1 – 3 s typical |

---

## Honest gaps — what's NOT production

Bring these up before they do. It builds credibility.

- **Authentication** — none. Real Mayo deployment needs SSO and
  patient-portal integration
- **PHI handling** — the assistant refuses to ingest medical
  history. A production system would also need redaction in
  logs, BAA with the model provider, and HIPAA review
- **Rate limit** — in-memory per warm container; resets on cold
  start. Swap Upstash Redis for real protection
- **Booking** — the assistant points to phone numbers and the
  request form; it doesn't actually book. The "appointment
  hand-off" pattern (chat collects context, pre-fills the form)
  is built in the roadmap branch
- **Telemetry** — feedback thumbs are wired in the UI but don't
  ship anywhere yet
- **Spanish content review** — the model translates on the fly;
  a real version should grade Spanish output against
  Mayo-approved translations
- **KB depth** — 18 entries is enough to demo the pattern, not
  enough to answer the long tail. 50–100 entries would be the
  minimum for soft launch

---

## Q&A — anticipated questions

### From executives / business leaders

**"Why doesn't it just book the appointment?"** — Booking
requires write access to Mayo's scheduling system. We
deliberately scoped this to information + hand-off. A booking
version is an integration project, not a model project.

**"What if someone asks about cancer treatment?"** — The
assistant refuses to give medical advice. For symptoms or
treatment questions, it directs the patient to their care team
or 911 if there's any urgency. The 911 banner is pinned to the
top of every conversation.

**"Could a malicious user trick it?"** — Two layers of defense.
First, the system prompt forbids invention beyond the knowledge
base — the model says "I don't have that information" rather
than guessing. Second, the system prompt lives only on the
server; the browser never sees it, so prompt-injection attacks
have nothing to override.

**"What does this cost to run?"** — Vercel Hobby tier is free
for stakeholder demos. Anthropic costs are per-token, on the
order of a fraction of a cent per conversation at current Sonnet
pricing. The thing that scales is engineering attention to KB
maintenance, not infrastructure.

**"How long would a real deployment take?"** — The widget and
pipeline are deployable in a day. Production hardening — auth,
PHI logging, persistent rate limiting, KB depth, accessibility
audit, language QA — is a six-to-eight-week engagement.

### From technical architects / product leads

**"Where does the system prompt live?"** — Server-side, in
`api/chat.js`, assembled per request from `BASE_RULES` plus
`kb.json` plus an optional Spanish language rule. Clients cannot
read or override it. Any `system` field on the request body is
explicitly ignored.

**"Why a JSON KB instead of vector search?"** — At 18 entries
it's well below the prompt-size threshold where retrieval pays
off. The model can see the whole KB on every call, so there's
nothing to miss. Beyond ~100 entries we'd switch to embeddings
+ retrieval; below that, inline is faster, simpler, and easier
to audit.

**"How does streaming work?"** — Vercel proxies the Anthropic
SSE response with `X-Accel-Buffering: no` and no buffering on
our end. The client reads the body as a `ReadableStream`,
parses `data:` lines per SSE spec, applies `content_block_delta`
events to the active bubble, and finalizes when the stream
closes. Control tokens are stripped at finalization, not during
streaming.

**"How are CTAs validated?"** — The system prompt lists the
exact four page-target IDs the model is allowed to use for
`show` actions. If the model emits something else, the client
ignores it silently. `phone` numbers come straight from the
knowledge base, so they can't be invented either.

**"Why Web Speech for voice?"** — Browser-native, zero
infrastructure, language-aware, no transcription bill. The
quality varies by platform — best on Apple devices, decent on
Chrome, hidden on Firefox. For a real deployment we'd benchmark
Deepgram or Whisper Realtime against this baseline.

**"Is this stateful?"** — The edge is stateless. Conversation
state lives only in the browser's history array; refresh loses
it, by design. Language preference is the only thing persisted,
in `localStorage`. A production version would push history to a
secure store keyed by patient identity.

**"What about accessibility?"** — Keyboard nav, ARIA labels,
focus management, full-screen mobile takeover, voice read-aloud,
screen-reader-friendly streaming. WCAG 2.2 AA audit is on the
production checklist.

---

## Closing line you can land

> "It's deliberately small. One HTML file, one server function,
> one JSON knowledge base. Every line of the stack is either
> doing patient-facing work or guarding the patient's trust.
> Nothing in between."
