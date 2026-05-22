#  Scheduling Assistant — Vercel Deployment

Deploy the chat widget + proxy to Vercel in about 10 minutes. No terminal, no
Node.js install — everything happens in your browser.
 
## What you're deploying

```
.
├── index.html       ← The chat widget (your existing UI)
├── api/
│   └── chat.js      ← Serverless function that proxies to Anthropic
├── package.json
└── vercel.json
```

When deployed, the widget at `https://yourapp.vercel.app/` calls the proxy
at `https://yourapp.vercel.app/api/chat`, which talks to Anthropic with
your server-side API key.

## You'll need

- A free Vercel account: <https://vercel.com/signup> (sign in with GitHub)
- A free GitHub account: <https://github.com/join>
- An Anthropic API key: <https://console.anthropic.com>

## Step-by-step

### 1. Put the files in a GitHub repo

Easiest path, no terminal:

1. Go to <https://github.com/new>
2. Repo name: `mayo-assistant-proxy` (or anything you like)
3. Set it to **Private**
4. Check **Add a README file**
5. Click **Create repository**
6. On the repo page, click **Add file → Upload files**
7. Drag in all four files: `index.html`, `package.json`, `vercel.json`,
   and the entire `api/` folder
8. Scroll down, click **Commit changes**

### 2. Deploy to Vercel

1. Go to <https://vercel.com/new>
2. Under **Import Git Repository**, find your `mayo-assistant-proxy` repo
   (you may need to grant Vercel access to your GitHub repos first)
3. Click **Import**
4. On the configure screen:
   - **Framework Preset:** Other
   - **Root Directory:** `./` (leave as default)
   - **Build Command:** leave blank
   - **Output Directory:** leave blank
5. Expand **Environment Variables** and add:
   - Name: `ANTHROPIC_API_KEY`
   - Value: `sk-ant-...` (paste your real key)
   - Click **Add**
6. (Optional) Add another env var:
   - Name: `CLAUDE_MODEL`
   - Value: `claude-sonnet-4-5-20250929`
7. Click **Deploy**

Wait ~1 minute for the build to finish. Vercel gives you a URL like
`https://mayo-assistant-proxy-xyz.vercel.app`.

### 3. Test it

Open the URL in your browser. The mock Mayo page loads. Click the
floating Mayo button in the bottom-right corner, ask a question — the
chat should respond.

If you see an error, click on the **Functions** tab in your Vercel
dashboard to see server-side logs from `api/chat.js`.

### 4. Share the link

That URL is now publicly accessible. Anyone with the link can chat
without setup, accounts, or installs.

## How to update the widget later

When you want to change the HTML or the system prompt:

1. Go to your GitHub repo
2. Click `index.html`, then the pencil icon (top-right) to edit
3. Make changes, commit
4. Vercel auto-deploys within ~30 seconds

## Custom domain (optional)

In your Vercel project: **Settings → Domains → Add**. You can use any
domain you own, free with the Hobby plan. Vercel walks you through DNS.

## Environment variables reference

| Variable             | Required | Default                             |
| -------------------- | -------- | ----------------------------------- |
| `ANTHROPIC_API_KEY`  | yes      | —                                   |
| `CLAUDE_MODEL`       | no       | `claude-sonnet-4-5-20250929`        |
| `ALLOWED_ORIGINS`    | no       | `*` (any origin can call the proxy) |

For production, set `ALLOWED_ORIGINS` to a comma-separated list of
exact origins, e.g. `https://yourapp.vercel.app,https://your-domain.com`.

## What's in the box

**`api/chat.js`** — Vercel serverless function. Receives `{system, messages}`
from the browser, validates the request, rate-limits (20/min per IP), forwards
to Anthropic with the API key, returns just `{text, usage}` to the browser.

**`index.html`** — Your chat widget, identical to the local version, except
it now calls `/api/chat` instead of `api.anthropic.com` directly.

**`vercel.json`** — Tells Vercel to send `Cache-Control: no-store` on API
responses (no caching of chat replies).

**`package.json`** — Declares Node 18+. Vercel needs this even though we
have zero npm dependencies.

## Free-tier limits (Hobby plan)

- 100 GB bandwidth/month — plenty for a stakeholder demo
- 100,000 serverless function invocations/month — also plenty
- 10-second function timeout — chat responses fit easily

If you outgrow the free tier (heavy public traffic), Vercel's Pro plan
is $20/month per user.

## What this proxy is NOT

Same gaps as before — for real Mayo deployment you'd still want auth,
PHI scrubbing in logs, persistent rate limiting (Redis), and Compliance
review. This is fine for stakeholder demos and small internal pilots.

## Troubleshooting

**"Server missing API key configuration"**
You didn't set the `ANTHROPIC_API_KEY` env var. Vercel dashboard → your
project → Settings → Environment Variables. After adding, you must
redeploy (Deployments tab → click the latest → Redeploy).

**"Upstream error 401"**
Bad or revoked API key. Check it in the Anthropic Console.

**"Upstream error 429"**
You're out of Anthropic credits or hitting their rate limit.

**"Too many requests"**
Local 20/min rate limit hit. Adjust in `api/chat.js`.

**Function times out**
Chat is hanging for >10 seconds. Likely an issue with the model name —
check Vercel function logs.
