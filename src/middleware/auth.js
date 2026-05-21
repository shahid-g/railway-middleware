const crypto = require('crypto');

/**
 * Verifies the ElevenLabs webhook HMAC-SHA256 signature.
 *
 * Tries multiple signing formats since the exact format can vary:
 *   Format A: HMAC("<timestamp>.<rawBody>")  ← documented format
 *   Format B: HMAC(rawBody)                  ← some implementations
 */
function verifyElevenLabsSignature(req, res, next) {
  const secret = process.env.ELEVENLABS_WEBHOOK_SECRET;

  if (!secret) {
    console.warn('[AUTH] ELEVENLABS_WEBHOOK_SECRET not set — skipping verification');
    return next();
  }

  const sigHeader = req.headers['elevenlabs-signature'];

  if (!sigHeader) {
    console.error('[AUTH] Missing ElevenLabs-Signature header');
    return res.status(401).json({ error: 'Missing ElevenLabs-Signature header' });
  }

  console.log('[AUTH] Raw signature header:', sigHeader);

  // ── Parse header ──────────────────────────────────────────────────────────
  let timestamp = null;
  let sigHash   = null;

  for (const part of sigHeader.split(',')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;
    const key   = part.slice(0, eqIdx).trim();
    const value = part.slice(eqIdx + 1).trim();
    if (key === 't')          timestamp = value;
    else if (/^v\d+$/.test(key) && !sigHash) sigHash = value;
  }

  if (!timestamp || !sigHash) {
    console.error('[AUTH] Could not parse header:', sigHeader);
    return res.status(401).json({ error: 'Malformed ElevenLabs-Signature header' });
  }

  // ── Get raw body ──────────────────────────────────────────────────────────
  const rawBody = req.rawBody
    ? req.rawBody.toString('utf8')
    : JSON.stringify(req.body);

  // ── Log exactly what we're working with ──────────────────────────────────
  console.log('[AUTH] timestamp :', timestamp);
  console.log('[AUTH] rawBody (first 120 chars):', rawBody.slice(0, 120));
  console.log('[AUTH] secret (first 8 chars):', secret.slice(0, 8) + '...');
  console.log('[AUTH] received hash:', sigHash);

  // ── Try Format A: HMAC("<timestamp>.<rawBody>") ───────────────────────────
  const hmacA = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');
  console.log('[AUTH] Format A (timestamp.body):', hmacA);

  // ── Try Format B: HMAC(rawBody) only ─────────────────────────────────────
  const hmacB = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  console.log('[AUTH] Format B (body only)     :', hmacB);

  // ── Try Format C: secret might be base64-encoded — decode it first ────────
  let hmacC = null;
  try {
    const decodedSecret = Buffer.from(secret, 'base64').toString('utf8');
    hmacC = crypto
      .createHmac('sha256', decodedSecret)
      .update(`${timestamp}.${rawBody}`)
      .digest('hex');
    console.log('[AUTH] Format C (b64-decoded secret):', hmacC);
  } catch (_) { /* ignore */ }

  // ── Check any format matches ──────────────────────────────────────────────
  const matched =
    safeEqual(hmacA, sigHash) ||
    safeEqual(hmacB, sigHash) ||
    (hmacC && safeEqual(hmacC, sigHash));

  if (matched) {
    console.log('[AUTH] ✓ Signature verified');
    return next();
  }

  console.error('[AUTH] ✗ Signature mismatch — none of the formats matched');
  console.error('[AUTH] Expected (A):', hmacA);
  console.error('[AUTH] Expected (B):', hmacB);
  console.error('[AUTH] Received    :', sigHash);
  return res.status(401).json({ error: 'Invalid ElevenLabs signature' });
}

function safeEqual(a, b) {
  try {
    const bufA = Buffer.from(a, 'hex');
    const bufB = Buffer.from(b, 'hex');
    return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

module.exports = { verifyElevenLabsSignature };
