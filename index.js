require('dotenv').config();
const express = require('express');
const doceboRoutes = require('./routes/docebo');
const elevenLabsRoutes = require('./routes/elevenlabs');

const app = express();
const PORT = process.env.PORT || 3000;

// Parse JSON bodies — raw body also preserved for webhook signature verification
app.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf; }
}));

// Health check for Railway
app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// ── Routes ───────────────────────────────────────────
app.use('/webhooks/docebo', doceboRoutes);
app.use('/webhooks/elevenlabs', elevenLabsRoutes);

// 404 catch-all
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// Global error handler
app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err.message, err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`[SERVER] Middleware running on port ${PORT}`);
  console.log(`[SERVER] Docebo update method: ${process.env.DOCEBO_UPDATE_METHOD || 'both'}`);
});
