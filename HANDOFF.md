# Handoff Brief — Mayo Scheduling Assistant

You're inheriting a working prototype that needs to be (a) embedded
into an internal page rather than the sample landing, and (b)
hardened against an enterprise platform's expectations (secrets,
CORS, hosting, compliance). This brief is the shortest path from
"got the zip" to "running it in our environment."

---

## Start here

Three docs you should read in this order:

1. **README.md** — the original ten-minute deploy guide (assumes Vercel)
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
transcript export). `api/chat.js` is the Vercel serverless
function — five-step pipeline (CORS → rate limit → validate →
build system prompt → stream SSE proxy). `kb.json` is the
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
   `<div class="chat-scrim">`). Roughly lines 1180–1330.
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

## Job #2 — Environment variables & secrets

The serverless function reads three environment variables:

| Variable | Required | Default | Notes |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | **yes** | — | Server-side only. Never ship to the client. |
| `CLAUDE_MODEL` | no | `claude-sonnet-4-6` | Pin a specific date-suffixed version (e.g. `claude-sonnet-4-6-20251101`) for reproducibility. |
| `ALLOWED_ORIGINS` | no | `*` | **Lock this down before any non-demo use.** Comma-separated list of exact origins (e.g. `https://internal.mayo.local`). |

For an enterprise platform you'll typically want:

- The API key stored in a managed secrets store (Azure Key Vault,
  AWS Secrets Manager, HashiCorp Vault) and pulled at deploy time,
  not pasted into a `.env` file.
- `ALLOWED_ORIGINS` locked to exact internal origins. The `*`
  default is fine for a demo; it's dangerous in production —
  any site could embed the proxy and burn your token budget.
- A separate `ANTHROPIC_API_KEY` per environment (dev / staging /
  prod) so you can rotate independently and trace usage.

---

## Customizing the demo content

| Want to change | File | Notes |
|---|---|---|
| Knowledge base entries | `kb.json` | Each entry is `{ id, title, url, content }`. IDs must be unique. Edit, commit, redeploy. |
| System prompt rules (scope, tone, guardrails) | `api/chat.js` | `BASE_RULES` template literal, lines ~32-77. |
| Spanish language rule | `api/chat.js` | `SPANISH_LANG_RULE` constant. |
| Show-me target IDs | `api/chat.js` | Rule 9 list, lines ~70-75. Must match `id="…"` attributes on the host page. |
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
- [ ] **PHI handling** — log redaction (currently every request body is potentially loggable by Vercel)
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

1. **Day 1** — Read README, ARCHITECTURE, this doc. Deploy a fresh
   instance with your own API key. Verify chat works end-to-end.
2. **Day 2** — Pick the target internal page. Lift widget HTML/CSS/JS
   into it. Confirm the widget renders alongside the host page.
3. **Day 3** — Update the system prompt's show-me target list and
   add `id="…"` attributes to host page elements. Verify a "show
   me" action highlights the right element.
4. **Day 4** — Customize `kb.json` and capability cards for the
   real content. QA with subject matter experts.
5. **Day 5** — Lock down `ALLOWED_ORIGINS`. Move the API key into
   the proper secrets store. Run a stakeholder demo.

---

## Contact handoff items to negotiate

When you meet the receiving team, surface these explicitly:

- Who owns the Anthropic billing relationship?
- Which platform are they deploying on (Vercel, internal Kubernetes,
  Azure App Service, etc.)? Different platforms have different SSE
  buffering behaviors.
- Does the internal page have a build pipeline? If yes, the widget
  can be a proper npm package; if no, single-file inclusion still works.
- Who owns the KB content review (Mayo SME)?
- What's the threshold for moving from demo to pilot?
