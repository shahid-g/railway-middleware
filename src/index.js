require('dotenv').config();

const express    = require('express');
const xapiRoutes = require('./routes/xapi');
const elRoutes   = require('./routes/elevenlabs');

const app  = express();
const PORT = process.env.PORT || 3000;

// Preserve raw body for ElevenLabs webhook signature verification
app.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf; }
}));

// ── Health check (used by Railway) ──────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

// ── Routes ───────────────────────────────────────────────────────────────────
// Docebo sends xAPI statements to /xapi/statements (configured in course settings)
app.use('/xapi', xapiRoutes);

// ElevenLabs fires completion webhook here when session ends
app.use('/webhooks/elevenlabs', elRoutes);

// ── 404 ──────────────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// ── Global error handler ─────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err.message, err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`[SERVER] Middleware running on port ${PORT}`);
  console.log(`[SERVER] xAPI receiver : POST /xapi/statements`);
  console.log(`[SERVER] ElevenLabs   : POST /webhooks/elevenlabs/done`);
  console.log(`[SERVER] Update method : ${process.env.DOCEBO_UPDATE_METHOD || 'both'}`);
});
