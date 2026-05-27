# Handoff Brief — Mayo Scheduling Assistant

You're inheriting a working prototype that needs to be (a) embedded
into an internal page rather than the sample landing, and (b)
hardened against an enterprise platform's expectations (secrets,
CORS, hosting, compliance). This brief is the shortest path from
"got the zip" to "running it in our environment."

---

## Start here

Three docs you should read in this order:

1. **README.md** — the original deploy guide. Note: assumes Vercel; see Job #2 below for GCP / Azure equivalents
2. **ARCHITECTURE.md** — system architecture, contracts, design decisions
3. **TALK_TRACK.md** — dual-audience briefing (engineers + business)

And three visual artifacts:

- **docs/architecture.svg** — technical view
- **docs/experience.svg** — patient-facing view
- **docs/workflow.svg** — request lifecycle sequence
- **docs/show-me-flow.svg** — how the "show me on the page" feature works end-to-end

---

## System recap in one paragraph

`index.html` is the entire client: the chat widget DOM, CSS, and
all JavaScript (streaming UI, L10N, voice, page highlighter,
transcript export). `api/chat.js` is the serverless function —
five-step pipeline (CORS → rate limit → validate → build
system prompt → stream SSE proxy). Currently written for
Vercel's handler signature; portable to GCP / Azure with a
thin Express wrapper (see Job #2). `kb.json` is the
externalized knowledge base, server-loaded once per warm
container. Claude Sonnet 4.6 does the generation. Nothing is
shared between the client and the LLM API key; the proxy is the
gate.

---

## Job #1 — Embedding into the real internal page

The sample `index.html` mixes the host page (mock Mayo landing)
and the widget. To embed in an actual internal page you'll want
to extract the widget.

**Three components to lift:**

1. **The widget HTML** — everything from `<button class="fab"…>`
   through the closing `</div>` of the chat widget (and the
   `<div class="chat-scrim">`). Roughly lines 1200–1305.
2. **The widget CSS** — every rule inside `<style>` that applies
   to `.fab`, `.fab-label`, `.fab-pulse`, `.chat-scrim`, `.chat-widget`,
   `.widget-*`, `.msg*`, `.cite-*`, `.cta*`, `.feedback`, `.chip`,
   `.followup*`, `.composer*`, `.thinking`, `.stream-caret`,
   `.disclaimer-line`, `.cap-*`, `.greeting-*`, `.menu-*`,
   `.back-to-chat`, `.scroll-pill`, `.lang-toggle`, `.tts-*`, and
   the `.page-highlight` keyframes used on the host's elements.
   Keep the `:root` token variables (`--mayo-blue`, etc.).
3. **The widget JS** — the entire `<script type="module">…</script>`
   block at the bottom of the file.

**Two things to remove** (these are demo-only):

- The mock Mayo page markup: `<div class="page">…</div>` and its
  children (`.page-nav`, `.hero`, `.content-grid` cards)
- The page-only CSS: `.page`, `.page-nav`, `.logo`, `.logo-*`,
  `.nav-*`, `.hero`, `.breadcrumb`, `.page-title`, `.lede`,
  `.content-grid`, `.card`

**Two things to update** for the real page:

- **Show-me targets** — replace the four hardcoded `page-*` IDs in
  the system prompt rule 9 (`api/chat.js` lines ~70-75) with IDs
  that match elements on the real internal page. Add matching
  `id="page-…"` attributes to those elements in the host HTML.
- **CSS isolation** — class names like `.msg`, `.card`, `.chip` are
  generic and will collide with internal CSS. Either prefix them
  all (`.mayo-msg`, `.mayo-card`, …) or wrap the whole widget in
  a Shadow DOM root and isolate styles. Plan for ~half a day.

**Recommended**: package the extracted widget as `mayo-assistant.js`
+ `mayo-assistant.css` so any internal page can include it with
two `<script>` / `<link>` tags. Make the show-me target list
dynamic — read `data-show-target="page-…"` attributes from the
host page on init and pass them to the server with each request.

---

## Job #2 — Choosing the deployment platform (GCP or Azure)

The current code is Vercel-shaped but **not Vercel-locked**.
`api/chat.js` is a standard Node.js HTTP handler — the only
Vercel-specific assumptions are the file location (`/api/*`
auto-routes to a function) and the handler signature
(`export default async function handler(req, res)` with
`req.body` already parsed as JSON).

### Recommended pattern: containerize

The cleanest path that works identically on GCP and Azure is to
**wrap the function in a small Express (or Fastify) app and deploy
as a container image**. Same image runs on:

- **GCP Cloud Run** (recommended for GCP) — managed containers, supports SSE natively, scale-to-zero, per-request billing
- **Azure Container Apps** (recommended for Azure) — same shape, KEDA-based scaling, supports SSE
- **GCP Cloud Functions Gen 2** — actually Cloud Run under the hood; you can deploy the same image as a function
- **Azure App Service** — for long-lived containers if scale-to-zero isn't a fit

Container image is ~30 LOC of Dockerfile + a thin Express
wrapper around the existing handler. Plan ~half a day to
refactor.

### Per-platform notes

**GCP Cloud Run**

- Streaming SSE works out of the box (HTTP/1.1 streaming)
- Secrets via **Secret Manager** mounted as env vars or files at deploy time (`gcloud run deploy --set-secrets ANTHROPIC_API_KEY=anthropic-key:latest`)
- Concurrency: set `--concurrency=80` (default) — fine for chat
- Min instances: set to 1 if you want to avoid cold-start latency on the first chat of the day; otherwise scale-to-zero
- Region: pick one close to your users (us-central1 for U.S. patients)

**Azure Container Apps**

- Streaming SSE works; **disable ingress response buffering** at the Container Apps level if you ever see replies arriving all at once (some setups buffer by default)
- Secrets via **Azure Key Vault** referenced from Container Apps as secret env vars
- Replica scaling: KEDA HTTP rule, min 0 / max 10 is a sane start for a stakeholder pilot
- Front Door / Application Gateway in front: explicitly configure no response buffering, no caching on `/api/chat`

**Azure Functions (alternative to Container Apps)**

- Possible but trickier — the v4 Node programming model supports streaming, but legacy v3 buffers responses. Use v4.
- Premium plan recommended (Consumption plan has cold-start + SSE quirks)
- Containerized Container Apps is the smoother path on Azure

**GCP Cloud Functions Gen 2 (alternative to Cloud Run)**

- Built on Cloud Run, so streaming works
- Use if you want the function-style deployment ergonomics over container-style

### What changes in the code per platform

| Concern | Vercel (current) | Cloud Run / Container Apps |
|---|---|---|
| Handler signature | `export default async function handler(req, res)` with `req.body` auto-parsed | Express middleware: `app.post('/api/chat', express.json(), handler)` |
| File routing | `/api/*.js` → auto-routed | Explicit routes in the Express app |
| Streaming | `res.flushHeaders()` + `res.write()` | Same (Node `http.ServerResponse` API) |
| Env vars | Project dashboard | Secret Manager (GCP) / Key Vault (Azure) |
| Cold start | ~200ms | ~500ms-1s on cold container; min-instances=1 avoids |

The function body itself — the five gates, the prompt
assembly, the Anthropic call, the SSE passthrough — is
unchanged. About 80% of `api/chat.js` ports verbatim.

### Static hosting for `index.html`

`index.html` is a single static file. Hosting options:

- **GCP**: Firebase Hosting (easiest, free CDN, custom domain), Cloud Storage + Cloud CDN, or serve from the same Cloud Run container
- **Azure**: Static Web Apps (easiest, also hosts the function), Blob Storage + Front Door, or serve from the same Container App

For the internal page case (where this widget gets embedded
into an existing internal site), you probably won't deploy
`index.html` at all — you'll lift the widget into the host
page and only the `/api/chat` function needs hosting.

---

## Job #3 — Environment variables & secrets

The serverless function reads three environment variables:

| Variable | Required | Default | Notes |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | **yes** | — | Server-side only. Never ship to the client. Store in Secret Manager (GCP) or Key Vault (Azure). |
| `CLAUDE_MODEL` | no | `claude-sonnet-4-6` | Pin a specific date-suffixed version (e.g. `claude-sonnet-4-6-20251101`) for reproducibility. |
| `ALLOWED_ORIGINS` | no | `*` | **Lock this down before any non-demo use.** Comma-separated list of exact origins (e.g. `https://internal.mayo.local`). |

For an enterprise platform you'll typically want:

- A separate `ANTHROPIC_API_KEY` per environment (dev / staging /
  prod) so you can rotate independently and trace usage
- `ALLOWED_ORIGINS` locked to exact internal origins. The `*`
  default is fine for a demo; it's dangerous in production —
  any site could embed the proxy and burn your token budget
- Secret rotation policy (Anthropic supports multiple active
  keys; you can rotate without downtime)

---

## Job #4 — Swapping the LLM (provider, model, or routing)

The current code talks directly to Anthropic's API. Mayo's team
may choose to (a) keep Claude but use a different key, (b) keep
Claude but route through AWS Bedrock or GCP Vertex AI for
compliance/billing reasons, or (c) switch to a different LLM
entirely. Each scenario touches different lines of `api/chat.js`.

The **good news**: the control tokens (`<<CITATIONS>>`,
`<<ACTION>>`) are part of the **system prompt**, not the API.
Any capable LLM can be instructed to emit them — so the
client-side parser and renderer don't change. Only the upstream
call and the SSE-parsing logic need adapting.

### Scenario A — Same provider, new API key (trivial)

Just rotate the env var. No code changes.

```
ANTHROPIC_API_KEY=<new-key>
```

### Scenario B — Same provider, different model version

Update the env var:

```
CLAUDE_MODEL=claude-sonnet-4-6-20251101    # pin a specific date
CLAUDE_MODEL=claude-opus-4-7               # switch model family
```

Heavier/lighter model, same wire format, same response shape.
Test that the system prompt still produces clean
`<<CITATIONS>>` / `<<ACTION>>` blocks — smaller models sometimes
forget the protocol.

### Scenario C — Claude via AWS Bedrock

If Mayo already has an AWS BAA in place, routing through Bedrock
keeps Claude but avoids a separate Anthropic contract.

What changes in `api/chat.js`:

| Concern | Direct (current) | Bedrock |
|---|---|---|
| Endpoint | `https://api.anthropic.com/v1/messages` | `https://bedrock-runtime.<region>.amazonaws.com/model/<model-id>/invoke-with-response-stream` |
| Auth | `x-api-key: <key>` header | AWS SigV4 signed request (use `@aws-sdk/client-bedrock-runtime`) |
| Request body | `{ model, system, messages, stream: true }` | Drop `model` (it's in the URL); add `anthropic_version: "bedrock-2023-05-31"` |
| Model ID | `claude-sonnet-4-6` | `anthropic.claude-sonnet-4-6-v1:0` (Bedrock format) |
| Streaming | Raw SSE chunks (`event: content_block_delta`) | Each chunk's `bytes` field is base64-encoded JSON of the equivalent SSE event — decode before parsing |
| Env vars | `ANTHROPIC_API_KEY` | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` (or IAM role on Cloud Run / Container Apps) |

The Bedrock SDK does most of the auth/signing work; the main
code change is parsing the wrapped chunks. ~30 lines.

### Scenario D — Claude via GCP Vertex AI

Equivalent to Bedrock but on the GCP side. Useful if you're
deploying on Cloud Run and want everything inside one cloud's
billing.

What changes:

| Concern | Direct (current) | Vertex AI |
|---|---|---|
| Endpoint | `https://api.anthropic.com/v1/messages` | `https://<region>-aiplatform.googleapis.com/v1/projects/<proj>/locations/<region>/publishers/anthropic/models/<model>:streamRawPredict` |
| Auth | `x-api-key: <key>` header | OAuth bearer token from a GCP service account (`@google-cloud/aiplatform`) |
| Request body | `{ model, system, messages, stream: true }` | Drop `model`; add `anthropic_version: "vertex-2023-10-16"` |
| Streaming | SSE chunks directly | Server-sent events in Vertex's chunked format |
| Env vars | `ANTHROPIC_API_KEY` | `GOOGLE_APPLICATION_CREDENTIALS` (or Workload Identity on Cloud Run) |

### Scenario E — Different provider entirely (OpenAI, Azure OpenAI, Gemini)

This is the biggest change. The wire format and response shape
differ; only the system prompt + control-token protocol
survive verbatim.

**Azure OpenAI / OpenAI** (most likely if Mayo standardizes on Azure):

| Concern | Anthropic (current) | OpenAI |
|---|---|---|
| Endpoint | `https://api.anthropic.com/v1/messages` | `https://<resource>.openai.azure.com/openai/deployments/<deployment>/chat/completions?api-version=2024-02-15-preview` |
| Auth | `x-api-key` | `api-key` header (Azure) or `Authorization: Bearer <key>` (OpenAI) |
| Request shape | `{ system: "...", messages: [{role, content}] }` | `{ messages: [{role:"system", content:"..."}, {role, content}, …] }` — system becomes a message |
| Model | `claude-sonnet-4-6` | `gpt-4o-mini`, `gpt-4o`, `gpt-4.1`, etc. |
| `max_tokens` | works | works (or `max_completion_tokens` on newer reasoning models) |
| Streaming events | `event: content_block_delta` with `data: {delta:{text:"..."}}` | `data: {choices:[{delta:{content:"..."}}]}` (no event name; just data lines) |
| Stream terminator | `event: message_stop` | `data: [DONE]` |

**Google Gemini** (if they want Google's stack):

| Concern | Anthropic (current) | Gemini |
|---|---|---|
| Endpoint | `https://api.anthropic.com/v1/messages` | `https://generativelanguage.googleapis.com/v1beta/models/<model>:streamGenerateContent?alt=sse&key=<key>` |
| Request shape | `{ system, messages }` | `{ systemInstruction:{parts:[{text}]}, contents:[{role,parts:[{text}]}] }` — different role names ("user"/"model") |
| Streaming events | SSE with `content_block_delta` | SSE with `data: {candidates:[{content:{parts:[{text:"..."}]}}]}` |

**Self-hosted / on-prem LLM** (e.g. Llama 3, Mixtral via vLLM, or
TGI behind an internal endpoint):

Most on-prem inference servers ship an **OpenAI-compatible
API**. Use the OpenAI scenario above with your internal
endpoint and (usually) a bearer token. Watch out for:
- Streaming compatibility — some self-hosted runtimes only
  partially implement the OpenAI streaming schema
- System prompt support — smaller models may need the system
  prompt prepended to the first user message instead of
  passed as a separate field

### What stays the same regardless of provider

- The system prompt structure (`BASE_RULES + kb.json + SPANISH_RULE`)
- The control-token protocol (`<<CITATIONS>>`, `<<ACTION>>`)
- The client-side parser (`parseResponse()` strips tokens after stream closes)
- The five-gate pipeline (CORS, rate limit, validate, build prompt, stream)
- Every L10N string, capability card, show-me target, and CSS file

You're essentially swapping out one ~30-line block of code (the
upstream fetch + the SSE-event-name parsing) and adjusting env
vars. The rest of the codebase is provider-agnostic.

### Where to make the change

The two functions to edit in `api/chat.js`:

1. **`handler()`** — the fetch call (lines ~117-140 in the
   current file). Replace endpoint, auth headers, request body
   shape per the scenario above.
2. **The SSE parsing loop** — currently in `index.html` inside
   `ask()` (the part that reads `eventName === 'content_block_delta'`).
   For OpenAI-style providers, switch to reading `data: { choices: [...] }`
   and the `[DONE]` terminator.

### Recommended decision flow for Mayo

1. **Do you already have an Anthropic contract / BAA?** → Stay
   direct, easiest path
2. **Do you have AWS with a BAA?** → Bedrock, ~30 lines of change
3. **Are you standardizing on Azure?** → Azure OpenAI with a
   GPT-class model, ~50 lines of change (different request shape)
4. **Are you on GCP and want everything in one cloud?** → Vertex
   AI with Claude (best balance) or Gemini (native GCP) — your call
5. **Do you have an internal LLM platform?** → OpenAI-compatible
   API against the internal endpoint, ~40 lines

In every case, **test the control-token output first**. Ask the
demo a question, inspect the raw response, confirm the model
emits well-formed `<<CITATIONS>>` and `<<ACTION>>` blocks. If a
weaker model drops them, tighten the system prompt with
explicit examples before switching back to a stronger model.

---

## Customizing the demo content

| Want to change | File | Notes |
|---|---|---|
| Knowledge base entries | `kb.json` | Each entry is `{ id, title, url, content }`. IDs must be unique. Edit, commit, redeploy. |
| System prompt rules (scope, tone, guardrails) | `api/chat.js` | `BASE_RULES` template literal, lines ~32-83. |
| Spanish language rule | `api/chat.js` | `SPANISH_LANG_RULE` constant. |
| Show-me target IDs | `api/chat.js` | Rule 9 list, lines ~71-74. Must match `id="…"` attributes on the host page. |
| Capability cards (greeting entries) | `index.html` | Look for `cards:` in the L10N table (EN + ES). |
| UI strings | `index.html` | The `L10N` table — every visible string is keyed. |
| Brand colors | `index.html` | `:root` token block (`--mayo-blue`, `--mayo-blue-deep`, etc.). |
| Logo | `index.html` | The `.logo` block — currently inline SVG. Replace with internal asset. |

---

## Adding / removing languages

The `L10N` table in `index.html` has two keys: `en` and `es`. To
add a third (e.g. Vietnamese), copy the `es` block, rename the
key, translate every string, and add the corresponding language
rule append to `api/chat.js` (mirror `SPANISH_LANG_RULE`).
Update `applyLang()` and the lang-toggle button to cycle through
the new option. ~2 hours per language.

---

## Production hardening checklist

Things this demo doesn't ship. Triage these before any real
patient deployment:

- [ ] **Authentication** — SSO / patient portal handshake; the demo is fully anonymous
- [ ] **PHI handling** — log redaction (request bodies appear in platform logs by default; GCP Cloud Logging and Azure Log Analytics both need redaction filters)
- [ ] **BAA with Anthropic** — required for PHI-adjacent use; coordinate with Mayo legal
- [ ] **HIPAA review** — full audit before clinical deployment
- [ ] **WCAG 2.2 AA audit** — keyboard nav, focus management, screen-reader labels, color contrast
- [ ] **Persistent rate limiting** — replace the in-memory bucket with Upstash Redis or equivalent. The current bucket resets on cold start
- [ ] **CORS allow-list** — set `ALLOWED_ORIGINS` to specific internal origins, never `*` in prod
- [ ] **CSP review** — the widget loads Google Fonts (Inter, Source Serif 4); either allowlist `fonts.googleapis.com` / `fonts.gstatic.com` or self-host the fonts
- [ ] **Telemetry pipeline** — feedback thumbs are wired in the UI but don't ship anywhere; pick a destination
- [ ] **Audit logging** — who asked what, when, and what the assistant said
- [ ] **Model lifecycle** — Anthropic deprecates older models; subscribe to changelog, add an alert if `CLAUDE_MODEL` returns a 4xx
- [ ] **KB depth** — 18 entries is enough to demo the pattern, not enough to answer the long tail. Plan for 50–100 entries minimum
- [ ] **Spanish content QA** — the model translates on the fly; have a native speaker review actual outputs
- [ ] **Voice quality** — Web Speech API quality varies by OS. For a production voice modality, plan for AWS Polly or ElevenLabs server-side TTS

---

## Common gotchas

- **Streaming requires no buffering middleware.** If your platform
  (corporate reverse proxy, ingress controller, WAF) buffers
  responses, streaming will break — replies will appear all at
  once at the end. Check for `X-Accel-Buffering: no` support,
  disable response buffering on the path, and verify
  `Cache-Control: no-store` is honored end-to-end.
- **iOS Safari TTS gesture rule.** Only one
  `SpeechSynthesisUtterance` per user click; the current widget
  chains them via `onend` to work around this. Don't refactor to
  batch-queueing.
- **CORS preflight 24h cache.** If you change `ALLOWED_ORIGINS`,
  browsers may take up to 24 hours to pick up the new
  `Access-Control-Allow-Origin` header. Reduce `Access-Control-Max-Age`
  during config churn.
- **Anthropic version header.** Pinned to `2023-06-01` in
  `api/chat.js`. Don't change without verifying the response
  shape — newer versions can change the SSE event names.
- **Google Fonts in offline environments.** If the internal page
  has no internet egress, the fonts won't load and the widget
  falls back to system sans (Inter is the primary).

---

## Preserved-but-unshipped features (roadmap)

These are designed, prototyped, and intentionally reverted to
keep the demo lean. The code lives in git history:

- **Hands-free auto-read** (`commit e58d693`) — header toggle and kebab option
  that auto-plays every reply
- **Appointment form hand-off** (`commit eb9af67`) — chat collects intent,
  pre-fills the on-page request form
- **Live agent handoff CTA** (`commit eb9af67`) — distinct "talk to a
  coordinator" button with optional wait-time badge
- **International transfer card** (`commit eb9af67`) — visually-distinct
  hand-off for international / UK patients

To revive any of these: `git show <commit>` to inspect, then
cherry-pick or copy the relevant blocks.

---

## What's deliberately out of scope

- **Real chat-to-chat handoff** to Mayo's existing LUMA assistant
  (requires Mayo-side handoff API)
- **Mid-conversation history retranslation** when toggling EN ↔ ES
  (decided as roadmap during demo)
- **Booking** — the assistant points to phone numbers and the
  request form; it doesn't book directly
- **Server-side neural TTS** (Polly, ElevenLabs) — current voice
  output uses Web Speech API browser-native

---

## Recommended first week for your team

1. **Day 1** — Read README, ARCHITECTURE, this doc. Pick the
   target platform (Cloud Run or Container Apps). Stand up a
   throwaway deploy on Vercel first if useful, just to see the
   working baseline before refactoring.
2. **Day 2** — Refactor `api/chat.js` behind a tiny Express
   wrapper. Containerize. Deploy to Cloud Run / Container Apps.
   Verify streaming SSE works end-to-end through any reverse
   proxy / ingress in the path — this is the most likely thing
   to break.
3. **Day 3** — Move secrets into Secret Manager / Key Vault.
   Lock `ALLOWED_ORIGINS` to the actual internal origin. Verify
   the proxy still streams.
4. **Day 4** — Pick the target internal page. Lift widget
   HTML/CSS/JS into it. Update the show-me target IDs in the
   system prompt to match real elements on that page. Confirm
   a "show me" action highlights the right element.
5. **Day 5** — Customize `kb.json` and capability cards for
   the real content. QA with subject matter experts. Run a
   stakeholder demo.

---

## Contact handoff items to negotiate

When you meet the receiving team, surface these explicitly:

- Who owns the Anthropic billing relationship?
- Confirm platform: GCP Cloud Run or Azure Container Apps both
  fit cleanly; legacy Azure App Service / GCP App Engine work
  but need extra streaming config. Verify SSE buffering behavior
  end-to-end (any reverse proxy, WAF, or ingress in front of the
  function can break streaming).
- Does the internal page have a build pipeline? If yes, the widget
  can be a proper npm package; if no, single-file inclusion still works.
- Who owns the KB content review (Mayo SME)?
- What's the threshold for moving from demo to pilot?
