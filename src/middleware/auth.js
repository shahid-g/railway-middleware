const crypto = require('crypto');

/**
 * Verifies the ElevenLabs webhook HMAC-SHA256 signature.
 *
 * ElevenLabs-Signature header format:
 *   t=<unix_timestamp>,v0=<hmac_hex>   ← ElevenLabs uses v0, not v1
 *
 * Signed content: "<timestamp>.<rawBody>"
 */
function verifyElevenLabsSignature(req, res, next) {
  const secret = process.env.ELEVENLABS_WEBHOOK_SECRET;

  if (!secret) {
    console.warn('[AUTH] ELEVENLABS_WEBHOOK_SECRET not set — skipping verification');
    return next();
  }

  const sigHeader = req.headers['elevenlabs-signature'];

  if (!sigHeader) {
    console.error('[AUTH] Missing ElevenLabs-Signature header. All headers:', JSON.stringify(Object.keys(req.headers)));
    return res.status(401).json({ error: 'Missing ElevenLabs-Signature header' });
  }

  console.log('[AUTH] Raw ElevenLabs-Signature:', sigHeader);

  // ── Parse header — flexible: accepts v0=, v1=, or any vN= prefix ─────────
  let timestamp = null;
  let sigHash   = null;

  for (const part of sigHeader.split(',')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;
    const key   = part.slice(0, eqIdx).trim();
    const value = part.slice(eqIdx + 1).trim();

    if (key === 't') {
      timestamp = value;
    } else if (/^v\d+$/.test(key)) {
      // Accept v0, v1, v2 … take the first one found
      if (!sigHash) sigHash = value;
    }
  }

  console.log(`[AUTH] Parsed — timestamp=${timestamp} hash=${sigHash ? sigHash.slice(0,10) + '...' : 'null'}`);

  if (!timestamp || !sigHash) {
    console.error(`[AUTH] Parse failed — timestamp=${timestamp} hash=${sigHash}. Full header: ${sigHeader}`);
    return res.status(401).json({
      error:            'Malformed ElevenLabs-Signature header',
      received_header:  sigHeader,
    });
  }

  // ── Optional: reject webhooks older than 5 minutes ───────────────────────
  const ageSeconds = Math.abs(Date.now() / 1000 - parseInt(timestamp, 10));
  if (ageSeconds > 300) {
    console.error(`[AUTH] Webhook too old: ${Math.round(ageSeconds)}s`);
    return res.status(401).json({ error: 'Webhook timestamp expired' });
  }

  // ── Build signed content: "<timestamp>.<rawBody>" ────────────────────────
  const rawBody      = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body);
  const signedString = `${timestamp}.${rawBody}`;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(signedString)
    .digest('hex');

  console.log(`[AUTH] Expected: ${expected.slice(0,10)}...  Received: ${sigHash.slice(0,10)}...`);

  // ── Constant-time comparison ──────────────────────────────────────────────
  try {
    const expBuf = Buffer.from(expected, 'hex');
    const rcvBuf = Buffer.from(sigHash,  'hex');

    if (expBuf.length !== rcvBuf.length || !crypto.timingSafeEqual(expBuf, rcvBuf)) {
      console.error('[AUTH] ✗ Signature mismatch');
      return res.status(401).json({ error: 'Invalid ElevenLabs signature' });
    }
  } catch (e) {
    console.error('[AUTH] Comparison error:', e.message);
    return res.status(401).json({ error: 'Signature comparison failed' });
  }

  console.log('[AUTH] ✓ Signature verified');
  next();
}

module.exports = { verifyElevenLabsSignature };
