require('dotenv').config();

const express      = require('express');
const launchRoutes = require('./routes/xapi');
const elRoutes     = require('./routes/elevenlabs');

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

// ── Launch route — mounted at BOTH / and /course ─────────────────────────────
// Handles all of these:
//   /launch
//   /course/launch
app.use('/',       launchRoutes);
app.use('/course', launchRoutes);

// ── ElevenLabs completion webhook ────────────────────────────────────────────
app.use('/webhooks/elevenlabs', elRoutes);

// ── 404 — log exact path so we can debug ────────────────────────────────────
app.use((req, res) => {
  console.warn(`[404] ${req.method} ${req.originalUrl}`);
  res.status(404).json({ error: 'Not found', path: req.originalUrl });
});

// ── Global error handler ─────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err.message, err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`[SERVER] Middleware running on port ${PORT}`);
  console.log(`[SERVER] Docebo launch  : GET|POST /launch  OR  /course/launch`);
  console.log(`[SERVER] ElevenLabs     : POST /webhooks/elevenlabs/done`);
  console.log(`[SERVER] Update method  : ${process.env.DOCEBO_UPDATE_METHOD || 'both'}`);
});
