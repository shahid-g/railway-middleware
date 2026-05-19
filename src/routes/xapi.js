const express   = require('express');
const router    = express.Router();
const { requireXapiVersion } = require('../middleware/auth');
const elevenLabsService      = require('../services/elevenlabs');

// ── xAPI spec requires these headers on every response ───────────────────────
function xapiHeaders(res, version) {
  res.setHeader('X-Experience-API-Version', version || '1.0.3');
  res.setHeader('Content-Type', 'application/json');
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /xapi/statements
//
// Docebo sends an xAPI statement to this URL when a learner opens a course.
// The URL is configured under the course settings in Docebo (xAPI / LRS URL).
//
// What we do here:
//  1. Validate the xAPI statement structure
//  2. Extract actor (learner) and object (course) from the statement
//  3. On a "launched" or "initialized" verb → create an ElevenLabs signed session
//  4. Return a valid xAPI response (204 or 200 with statement ID)
//  5. The signed ElevenLabs URL is returned so it can be surfaced to the learner
// ─────────────────────────────────────────────────────────────────────────────
router.post('/statements', requireXapiVersion, async (req, res) => {
  const version = req.xapiVersion;

  try {
    const statement = req.body;
    console.log('[xAPI] Statement received:', JSON.stringify(statement, null, 2));

    // ── Validate minimum required xAPI fields ─────────────────────────────
    if (!statement.actor || !statement.verb || !statement.object) {
      xapiHeaders(res, version);
      return res.status(400).json({ error: 'Invalid xAPI statement: missing actor, verb, or object' });
    }

    // ── Extract statement ID (or generate one) ────────────────────────────
    const statementId = statement.id || require('uuid').v4();

    // ── Extract verb ──────────────────────────────────────────────────────
    const verbId = statement.verb?.id || '';
    const verbName = verbId.split('/').pop().toLowerCase(); // e.g. "launched", "initialized"

    // ── Extract learner identity ──────────────────────────────────────────
    // Docebo sends actor as either account or mbox
    const actor   = statement.actor;
    const userId  = actor?.account?.name          // account-based (most common in Docebo)
                 || actor?.mbox?.replace('mailto:', '') // mbox fallback
                 || actor?.name
                 || 'unknown';

    const userEmail = actor?.mbox?.replace('mailto:', '') || actor?.account?.name || '';
    const userName  = actor?.name || '';

    // ── Extract course identity ───────────────────────────────────────────
    const objectId   = statement.object?.id || '';
    // Parse courseId from the object IRI, e.g. https://company.docebosaas.com/course/123
    const courseId   = objectId.split('/').pop() || objectId;
    const courseName = statement.object?.definition?.name?.['en-US']
                    || statement.object?.definition?.name?.['en']
                    || `Course ${courseId}`;

    console.log(`[xAPI] Verb: ${verbName} | User: ${userId} | Course: ${courseId}`);

    // ── Only act on launch/init verbs — acknowledge everything else ────────
    const isLaunch = ['launched', 'initialized', 'attempted'].includes(verbName);

    if (isLaunch) {
      // Create a signed ElevenLabs session for this learner
      const session = await elevenLabsService.createSignedSession({
        userId,
        courseId,
        userName,
        userEmail,
        courseName,
      });

      console.log(`[xAPI] ElevenLabs session created — conversationId: ${session.conversationId}`);
      console.log(`[xAPI] Signed URL: ${session.signedUrl}`);

      // ── Return 200 with statement ID + the ElevenLabs session URL ────────
      // The xAPI spec allows a 200 response body for POST /statements.
      // We include the signed URL as an extension so the course content
      // (or an intermediary page) can redirect the learner into ElevenLabs.
      xapiHeaders(res, version);
      return res.status(200).json({
        // xAPI spec: POST /statements returns array of statement IDs
        statementIds: [statementId],
        // Extension: ElevenLabs session for this learner
        elevenlabs: {
          signed_url:      session.signedUrl,
          conversation_id: session.conversationId,
          agent_id:        process.env.ELEVENLABS_AGENT_ID,
        },
      });
    }

    // ── All other verbs (passed, failed, completed etc.) — just acknowledge ─
    xapiHeaders(res, version);
    return res.status(200).json({ statementIds: [statementId] });

  } catch (err) {
    console.error('[xAPI] Handler error:', err.message, err.stack);
    xapiHeaders(res, version);
    return res.status(500).json({ error: 'Failed to process xAPI statement' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /xapi/statements
// Required by the xAPI spec — LRS must support GET. Docebo may probe this.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/statements', requireXapiVersion, (req, res) => {
  xapiHeaders(res, req.xapiVersion);
  // Return empty result set — we are not a full LRS, just a receiver
  return res.status(200).json({
    statements: [],
    more: '',
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /xapi/statements
// xAPI spec also allows PUT for a single statement with an explicit ID.
// ─────────────────────────────────────────────────────────────────────────────
router.put('/statements', requireXapiVersion, async (req, res) => {
  // Treat the same as POST
  req.method = 'POST';
  xapiHeaders(res, req.xapiVersion);
  return res.status(204).send();
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /xapi/about
// xAPI spec endpoint — LRS must respond to /about with supported versions.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/about', (_req, res) => {
  res.setHeader('X-Experience-API-Version', '1.0.3');
  return res.status(200).json({
    version: ['1.0.3', '1.0.2', '1.0.1', '1.0.0'],
    extensions: {},
  });
});

module.exports = router;
