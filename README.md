# Docebo ↔ ElevenLabs Middleware

Railway-hosted Node.js middleware that bridges Docebo LMS (via xAPI) and ElevenLabs Conversational AI.

---

## Exact directory structure (must match this exactly)

```
docebo-elevenlabs-middleware/   ← push THIS folder as the repo root
├── Procfile
├── railway.toml
├── package.json
├── .env.example
├── README.md
└── src/
    ├── index.js
    ├── middleware/
    │   └── auth.js
    ├── routes/
    │   ├── xapi.js
    │   └── elevenlabs.js
    └── services/
        ├── elevenlabs.js
        └── docebo.js
```

> ⚠️ The folder containing `package.json` and `src/` must be the **git repo root**.
> If you push a parent folder, Railway will not find `src/index.js` and will error.

---

## Architecture

```
Learner opens course in Docebo
        │
        ▼  xAPI statement (verb: launched)
        │  POST https://your-app.up.railway.app/xapi/statements
        ▼
Railway — xAPI receiver (/xapi/statements)
        │
        ├─► Calls ElevenLabs API to create signed session URL
        │
        └─► Returns signed URL in response
                │
                ▼ Course content redirects learner to ElevenLabs
        Learner completes audio Q&A inside ElevenLabs
                │
                ▼  ElevenLabs fires completion webhook
        Railway — ElevenLabs webhook (/webhooks/elevenlabs/done)
                │
                ├─► Docebo REST API  — mark complete + store transcript
                └─► Docebo xAPI LRS — send "completed" xAPI statement
```

---

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Railway health check |
| `POST` | `/xapi/statements` | Receives xAPI launch from Docebo |
| `GET` | `/xapi/statements` | xAPI spec compliance (returns empty) |
| `GET` | `/xapi/about` | xAPI spec compliance |
| `POST` | `/webhooks/elevenlabs/done` | ElevenLabs completion webhook |

---

## Deploy to Railway (step by step)

### 1. Make sure the repo root is correct

```bash
# The root of your git repo must contain package.json and src/
ls
# Procfile  README.md  package.json  railway.toml  src/
```

### 2. Push to GitHub

```bash
git init
git add .
git commit -m "initial"
git remote add origin https://github.com/YOUR_ORG/YOUR_REPO.git
git push -u origin main
```

### 3. Create Railway project

- Go to railway.app → New Project → Deploy from GitHub repo
- Select your repo

### 4. Add environment variables in Railway dashboard

Go to your service → **Variables** tab and add:

```
ELEVENLABS_API_KEY=
ELEVENLABS_AGENT_ID=
ELEVENLABS_WEBHOOK_SECRET=
DOCEBO_BASE_URL=
DOCEBO_CLIENT_ID=
DOCEBO_CLIENT_SECRET=
DOCEBO_UPDATE_METHOD=both
XAPI_ENDPOINT=
XAPI_KEY=
```

### 5. Generate public domain

Service → **Settings → Networking → Generate Domain**

You will get: `https://your-app.up.railway.app`

Verify:
```bash
curl https://your-app.up.railway.app/health
# → {"status":"ok","ts":"..."}

curl https://your-app.up.railway.app/xapi/about
# → {"version":["1.0.3",...],"extensions":{}}
```

---

## Configure Docebo

In Docebo course settings → **xAPI / LRS configuration**:

```
LRS Endpoint:  https://your-app.up.railway.app/xapi
```

Docebo will POST to `/xapi/statements` automatically when a learner launches the course.

---

## Configure ElevenLabs

In ElevenLabs Dashboard → Conversational AI → your agent → **Webhooks**:

```
Event:   conversation.ended
URL:     https://your-app.up.railway.app/webhooks/elevenlabs/done
Secret:  (same as ELEVENLABS_WEBHOOK_SECRET)
```

---

## Troubleshooting

| Error | Fix |
|---|---|
| `Cannot find module '/app/src/index.js'` | `package.json` is not at the repo root — check that `src/` and `package.json` are siblings |
| `401 Missing ElevenLabs-Signature` | Set `ELEVENLABS_WEBHOOK_SECRET` in Railway variables to match ElevenLabs agent webhook secret |
| `Docebo REST 401` | Check `DOCEBO_CLIENT_ID` and `DOCEBO_CLIENT_SECRET` are correct OAuth2 credentials |
| Service sleeps / misses webhooks | Upgrade Railway to Hobby plan ($5/mo) for always-on |
