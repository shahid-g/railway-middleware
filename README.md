# Docebo ↔ ElevenLabs Middleware (Railway)

Node.js/Express middle layer deployed on Railway that bridges Docebo LMS and ElevenLabs Conversational AI.

---

## Architecture

```
User starts course in Docebo
        │
        ▼ webhook
Railway (/webhooks/docebo/course-start)
        │
        ├─► ElevenLabs API — create signed session URL
        │
        └─► Return URL to Docebo (stored in custom field)
                │
                ▼ User completes audio Q&A in ElevenLabs
        ElevenLabs fires completion webhook
        │
        ▼
Railway (/webhooks/elevenlabs/done)
        │
        ├─► Docebo REST API  — mark complete + store transcript
        └─► Docebo xAPI LRS — send xAPI statement
```

---

## Setup

### 1. Clone and install

```bash
npm install
cp .env.example .env
# Fill in all values in .env
```

### 2. Environment variables

| Variable | Description |
|---|---|
| `ELEVENLABS_API_KEY` | Your ElevenLabs API key |
| `ELEVENLABS_AGENT_ID` | The Conversational AI agent ID |
| `ELEVENLABS_WEBHOOK_SECRET` | Secret to verify ElevenLabs webhooks |
| `DOCEBO_BASE_URL` | e.g. `https://yourcompany.docebosaas.com` |
| `DOCEBO_CLIENT_ID` | Docebo OAuth2 client ID |
| `DOCEBO_CLIENT_SECRET` | Docebo OAuth2 client secret |
| `DOCEBO_WEBHOOK_SECRET` | Secret to verify Docebo webhooks |
| `XAPI_ENDPOINT` | Docebo LRS xAPI endpoint |
| `XAPI_KEY` | Base64 xAPI auth key |
| `DOCEBO_UPDATE_METHOD` | `rest`, `xapi`, or `both` (default: `both`) |

### 3. Deploy to Railway

```bash
# Install Railway CLI
npm i -g @railway/cli

railway login
railway init
railway up
```

Railway will assign a public URL, e.g.:
`https://your-project.up.railway.app`

### 4. Configure Docebo webhook

In Docebo Admin → Settings → Webhooks:
- **Event**: Course enrollment / user starts course
- **URL**: `https://your-project.up.railway.app/webhooks/docebo/course-start`
- **Secret**: set `DOCEBO_WEBHOOK_SECRET` to match

### 5. Configure ElevenLabs webhook

In ElevenLabs Dashboard → Conversational AI → Your Agent → Webhooks:
- **Completion URL**: `https://your-project.up.railway.app/webhooks/elevenlabs/done`
- **Events**: conversation.ended
- **Secret**: set `ELEVENLABS_WEBHOOK_SECRET` to match

---

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Railway health check |
| `POST` | `/webhooks/docebo/course-start` | Receives Docebo course initiation |
| `POST` | `/webhooks/elevenlabs/done` | Receives ElevenLabs completion |

---

## Customisation

### Docebo custom fields
Update `src/services/docebo.js` → `updateViaRestApi()` to use your actual Docebo custom field keys.

### ElevenLabs metadata
If your ElevenLabs agent is configured to pass metadata in the webhook, update the field names in `src/routes/elevenlabs.js` accordingly.

### xAPI verb
Default is `completed`. To use `answered` or a custom verb, update `updateViaXapi()` in `src/services/docebo.js`.
