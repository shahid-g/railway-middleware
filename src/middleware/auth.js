const crypto = require('crypto');

/**
 * Verifies the ElevenLabs webhook HMAC-SHA256 signature.
 *
 * Official ElevenLabs signature format (from docs):
 *   Header: ElevenLabs-Signature: t=<unix_timestamp>,v1=<hmac_hex>
 *   Signed content: "<timestamp>.<rawBody>"
 *
 * If ELEVENLABS_WEBHOOK_SECRET is not set, verification is skipped with a warning.
 */
function verifyElevenLabsSignature(req, res, next) {
  const secret = process.env.ELEVENLABS_WEBHOOK_SECRET;

  if (!secret) {
    console.warn('[AUTH] ELEVENLABS_WEBHOOK_SECRET not set — skipping signature verification');
    return next();
  }

  const sigHeader = req.headers['elevenlabs-signature'];

  if (!sigHeader) {
    console.error('[AUTH] Missing ElevenLabs-Signature header. Headers received:', JSON.stringify(req.headers));
    return res.status(401).json({ error: 'Missing ElevenLabs-Signature header' });
  }

  console.log('[AUTH] ElevenLabs-Signature header:', sigHeader);

  // Parse "t=<timestamp>,v1=<hash>"
  let timestamp = null;
  let v1Hash    = null;

  for (const part of sigHeader.split(',')) {
    const [key, value] = part.split('=');
    if (key === 't')  timestamp = value;
    if (key === 'v1') v1Hash    = value;
  }

  if (!timestamp || !v1Hash) {
    console.error('[AUTH] Could not parse ElevenLabs-Signature. Got:', sigHeader);
    return res.status(401).json({ error: 'Malformed ElevenLabs-Signature header' });
  }

  // Optional: reject webhooks older than 5 minutes to prevent replay attacks
  const ageSeconds = Math.abs(Date.now() / 1000 - parseInt(timestamp, 10));
  if (ageSeconds > 300) {
    console.error(`[AUTH] Webhook timestamp too old: ${ageSeconds}s`);
    return res.status(401).json({ error: 'Webhook timestamp too old' });
  }

  // Signed content = "<timestamp>.<rawBody>"
  const rawBody  = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body);
  const signedContent = `${timestamp}.${rawBody}`;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(signedContent)
    .digest('hex');

  console.log('[AUTH] Expected signature:', expected);
  console.log('[AUTH] Received signature:', v1Hash);

  try {
    const expectedBuf = Buffer.from(expected, 'hex');
    const receivedBuf = Buffer.from(v1Hash,   'hex');

    if (expectedBuf.length !== receivedBuf.length ||
        !crypto.timingSafeEqual(expectedBuf, receivedBuf)) {
      console.error('[AUTH] Signature mismatch');
      return res.status(401).json({ error: 'Invalid ElevenLabs signature' });
    }
  } catch (e) {
    console.error('[AUTH] Signature comparison error:', e.message);
    return res.status(401).json({ error: 'Signature verification failed' });
  }

  console.log('[AUTH] ✓ ElevenLabs signature verified');
  next();
}

module.exports = { verifyElevenLabsSignature };
