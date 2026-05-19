const crypto = require('crypto');

/**
 * Verifies the ElevenLabs completion webhook HMAC-SHA256 signature.
 * ElevenLabs sends the signature in the "ElevenLabs-Signature" header.
 */
function verifyElevenLabsSignature(req, res, next) {
  const secret = process.env.ELEVENLABS_WEBHOOK_SECRET;

  if (!secret) {
    console.warn('[AUTH] ELEVENLABS_WEBHOOK_SECRET not set — skipping signature check');
    return next();
  }

  const signature = req.headers['elevenlabs-signature'];
  if (!signature) {
    return res.status(401).json({ error: 'Missing ElevenLabs-Signature header' });
  }

  const expected = crypto
    .createHmac('sha256', secret)
    .update(req.rawBody)
    .digest('hex');

  // ElevenLabs may prefix with "sha256="
  const sigValue = signature.startsWith('sha256=') ? signature.slice(7) : signature;

  try {
    if (!crypto.timingSafeEqual(Buffer.from(sigValue, 'hex'), Buffer.from(expected, 'hex'))) {
      return res.status(401).json({ error: 'Invalid ElevenLabs signature' });
    }
  } catch {
    return res.status(401).json({ error: 'Malformed ElevenLabs signature' });
  }

  next();
}

/**
 * Validates that an incoming request carries a valid xAPI version header.
 * Docebo (and any xAPI-compliant LMS) must include X-Experience-API-Version.
 */
function requireXapiVersion(req, res, next) {
  const version = req.headers['x-experience-api-version'];
  if (!version) {
    return res.status(400).json({ error: 'Missing X-Experience-API-Version header' });
  }
  // Attach so downstream handlers can echo it back
  req.xapiVersion = version;
  next();
}

module.exports = { verifyElevenLabsSignature, requireXapiVersion };
