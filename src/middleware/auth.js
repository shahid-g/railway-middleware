const crypto = require('crypto');

/**
 * Verifies the ElevenLabs webhook HMAC-SHA256 signature.
 *
 * Set ELEVENLABS_SKIP_SIGNATURE_VERIFY=true in Railway to bypass
 * verification temporarily while debugging.
 */
function verifyElevenLabsSignature(req, res, next) {
  const secret     = process.env.ELEVENLABS_WEBHOOK_SECRET;
  const skipVerify = process.env.ELEVENLABS_SKIP_SIGNATURE_VERIFY === 'true';

  // ── Bypass mode — use to unblock webhook while debugging ─────────────────
  if (skipVerify || !secret) {
    console.warn('[AUTH] Signature verification BYPASSED — set ELEVENLABS_SKIP_SIGNATURE_VERIFY=false to enforce');
    return next();
  }

  const sigHeader = req.headers['elevenlabs-signature'];
  if (!sigHeader) {
    console.error('[AUTH] Missing ElevenLabs-Signature header');
    return res.status(401).json({ error: 'Missing ElevenLabs-Signature header' });
  }

  // ── Parse t= and vN= parts ────────────────────────────────────────────────
  let timestamp = null;
  let sigHash   = null;
  for (const part of sigHeader.split(',')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;
    const key   = part.slice(0, eqIdx).trim();
    const value = part.slice(eqIdx + 1).trim();
    if (key === 't')                           timestamp = value;
    else if (/^v\d+$/.test(key) && !sigHash)  sigHash   = value;
  }

  if (!timestamp || !sigHash) {
    return res.status(401).json({ error: 'Malformed ElevenLabs-Signature header' });
  }

  // ── Capture raw body exactly as received ─────────────────────────────────
  const rawBody = req.rawBody
    ? req.rawBody.toString('utf8')
    : JSON.stringify(req.body);

  // ── Try all known secret and body combinations ────────────────────────────
  const secretVariants = [
    secret,                                           // as-is:  "wsec_dc6..."
    secret.replace(/^wsec_/, ''),                     // strip "wsec_" prefix
    secret.trim(),                                    // trim whitespace
    secret.replace(/^wsec_/, '').trim(),              // strip + trim
  ];

  const bodyVariants = [
    `${timestamp}.${rawBody}`,                        // Format A: timestamp.body
    rawBody,                                          // Format B: body only
    `${timestamp}.${rawBody.replace(/\s/g, '')}`,     // Format A, whitespace stripped
  ];

  let matched       = false;
  let matchedDesc   = '';

  outer:
  for (const [si, sec] of secretVariants.entries()) {
    for (const [bi, body] of bodyVariants.entries()) {
      const hmac = crypto.createHmac('sha256', sec).update(body).digest('hex');
      if (safeEqual(hmac, sigHash)) {
        matched     = true;
        matchedDesc = `secret[${si}] + body[${bi}]`;
        break outer;
      }
    }
  }

  if (!matched) {
    // Log enough info to debug without exposing secrets
    console.error('[AUTH] ✗ Signature mismatch');
    console.error('[AUTH] received :', sigHash);
    console.error('[AUTH] timestamp:', timestamp);
    console.error('[AUTH] body len :', rawBody.length);
    console.error('[AUTH] body(120):', rawBody.slice(0, 120));
    console.error('[AUTH] secret pfx:', secret.slice(0, 8));
    return res.status(401).json({ error: 'Invalid ElevenLabs signature' });
  }

  console.log(`[AUTH] ✓ Signature verified (${matchedDesc})`);
  next();
}

function safeEqual(a, b) {
  try {
    const ba = Buffer.from(a, 'hex');
    const bb = Buffer.from(b, 'hex');
    return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
  } catch { return false; }
}

module.exports = { verifyElevenLabsSignature };
