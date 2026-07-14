# Deploy Guide — Creator Field Assistant v2

## Prerequisites
- `CLOUDFLARE_API_TOKEN` set in environment (already done: token is saved in `~/.bashrc`)
- `gh` CLI authenticated

---

## Step 1 — One-time Cloudflare setup

```bash
# 1. Create the D1 database
npx wrangler d1 create creator-field-assistant

# Copy the database_id from the output, then edit wrangler.toml:
# Replace REPLACE_WITH_D1_ID with the actual ID

# 2. Create the KV namespace
npx wrangler kv:namespace create "CFA_KV"

# Copy the id from the output, then edit wrangler.toml:
# Replace REPLACE_WITH_KV_ID with the actual ID

# 3. Apply the schema
npx wrangler d1 execute creator-field-assistant --file=worker/schema.sql

# 4. Deploy the Worker
npx wrangler deploy

# 5. Copy the Worker URL from the deploy output
# It will look like: https://creator-field-assistant-api.tylerdotai.workers.dev
```

---

## Step 2 — Update API proxy URL

Edit `app/api/[...path]/route.js` and replace the `WORKER_URL` with your actual Worker URL:

```js
const WORKER_URL = "https://creator-field-assistant-api.tylerdotai.workers.dev";
```

---

## Step 3 — Push to GitHub

```bash
cd /tmp/creator-field-assistant-v2
git init
git add .
git commit -m "v2 — Cloudflare backend, auth, IndexedDB fallback"
gh repo create tylerdotai/creator-field-assistant-v2 --public
git remote add origin https://github.com/tylerdotai/creator-field-assistant-v2
git push -u origin main
```

---

## Step 4 — Deploy to Vercel

```bash
# From the repo
npx vercel --prod
```

Or push to GitHub and connect the repo to Vercel at vercel.com.

---

## Step 5 — Environment variables on Vercel

If you add a custom domain or change the Worker URL, update `WORKER_URL` in `app/api/[...path]/route.js`.

---

## What the v2 architecture does

```
Browser                    Next.js (Vercel)           Cloudflare Worker
   │                            │                           │
   ├── POST /api/auth/register ──►│── proxy ───────────────► Worker
   │                            │                           ├── hash password
   │                            │◄── token ────────────────┤
   │◄── session cookie ─────────┤                           └── store in D1 + KV
   │                            │                           │
   ├── GET /api/projects ───────►│── Bearer token ─────────► Worker
   │                            │                           ├── verify token (KV)
   │                            │◄── projects JSON ─────────┤
   │◄── projects ───────────────┤                           └── query D1
   │                            │                           │
   └── Offline: IndexedDB ◄─────┼───────────────────────────┘
```

- **Logged in**: all data syncs to Cloudflare D1 — persistent across devices
- **Logged out**: full offline support via existing IndexedDB
- **Auth**: email + password → JWT stored in localStorage, validated on every API call
