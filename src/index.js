require('dotenv').config();

const express      = require('express');
const launchRoutes = require('./routes/xapi');
const elRoutes     = require('./routes/elevenlabs');
const { verifyConfig } = require('./services/elevenlabs');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Body parsers ─────────────────────────────────────────────────────────────
app.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf; }
}));
app.use(express.urlencoded({ extended: true }));

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

// ── Diagnostic: test ElevenLabs API key + Agent ID ───────────────────────────
// curl https://your-app.up.railway.app/test-elevenlabs
app.get('/test-elevenlabs', async (_req, res) => {
  try {
    const result = await verifyConfig();
    const allGood = result.api_key_set && result.agent_id_set && result.signed_url_reachable;
    res.status(allGood ? 200 : 400).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Launch route — handles /launch and /course/launch ────────────────────────
app.use('/',       launchRoutes);
app.use('/course', launchRoutes);

// ── ElevenLabs completion webhook ────────────────────────────────────────────
app.use('/webhooks/elevenlabs', elRoutes);

// ── 404 — log exact path ──────────────────────────────────────────────────────
app.use((req, res) => {
  console.warn(`[404] ${req.method} ${req.originalUrl}`);
  res.status(404).json({ error: 'Not found', path: req.originalUrl });
});

// ── Global error handler ─────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err.message, err.stack);
  res.status(500).json({ error: 'Internal server error', detail: err.message });
});

app.listen(PORT, () => {
  console.log(`[SERVER] Middleware running on port ${PORT}`);
  console.log(`[SERVER] Docebo launch     : GET|POST /launch  OR  /course/launch`);
  console.log(`[SERVER] ElevenLabs webhook: POST /webhooks/elevenlabs/done`);
  console.log(`[SERVER] Diagnostic        : GET /test-elevenlabs`);
  console.log(`[SERVER] Update method     : ${process.env.DOCEBO_UPDATE_METHOD || 'both'}`);
});
