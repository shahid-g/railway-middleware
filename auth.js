const crypto = require('crypto');

/**
 * Verifies Docebo webhook HMAC signature.
 * Docebo signs the raw body with HMAC-SHA256 and sends it in X-Docebo-Signature.
 */
function verifyDoceboSignature(req, res, next) {
  const secret = process.env.DOCEBO_WEBHOOK_SECRET;
  if (!secret) {
    console.warn('[AUTH] DOCEBO_WEBHOOK_SECRET not set — skipping signature check');
    return next();
  }

  const signature = req.headers['x-docebo-signature'];
  if (!signature) {
    return res.status(401).json({ error: 'Missing Docebo signature header' });
  }

  const expected = crypto
    .createHmac('sha256', secret)
    .update(req.rawBody)
    .digest('hex');

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return res.status(401).json({ error: 'Invalid Docebo signature' });
  }

  next();
}

/**
 * Verifies ElevenLabs webhook signature.
 * ElevenLabs sends the HMAC-SHA256 signature in the ElevenLabs-Signature header.
 */
function verifyElevenLabsSignature(req, res, next) {
  const secret = process.env.ELEVENLABS_WEBHOOK_SECRET;
  if (!secret) {
    console.warn('[AUTH] ELEVENLABS_WEBHOOK_SECRET not set — skipping signature check');
    return next();
  }

  const signature = req.headers['elevenlabs-signature'];
  if (!signature) {
    return res.status(401).json({ error: 'Missing ElevenLabs signature header' });
  }

  const expected = crypto
    .createHmac('sha256', secret)
    .update(req.rawBody)
    .digest('hex');

  const sigValue = signature.startsWith('sha256=') ? signature.slice(7) : signature;

  if (!crypto.timingSafeEqual(Buffer.from(sigValue), Buffer.from(expected))) {
    return res.status(401).json({ error: 'Invalid ElevenLabs signature' });
  }

  next();
}

module.exports = { verifyDoceboSignature, verifyElevenLabsSignature };
