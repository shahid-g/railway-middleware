const express           = require('express');
const router            = express.Router();
const elevenLabsService = require('../services/elevenlabs');

// ─────────────────────────────────────────────────────────────────────────────
// GET  /launch   — Docebo may call via GET with query string params
// POST /launch   — Docebo may call via POST with form or query params
//
// Parameters sent by Docebo (as query params or form-encoded body):
//   endpoint    - the LRS/launch endpoint (informational, logged)
//   auth        - auth token Docebo passes (informational, logged)
//   user_id     - Docebo internal user ID
//   course_id   - Docebo course ID
//   username    - learner username / login
//   course_code - course code / reference
//   actor       - JSON string: {"mbox":["mailto:user@example.com"],"name":["Full Name"]}
//
// Response:
//   Redirects the learner straight into the ElevenLabs signed session URL
//   OR returns JSON with the URL (depending on how Docebo handles the response)
// ─────────────────────────────────────────────────────────────────────────────

async function launchHandler(req, res) {
  try {
    // Merge query params + body so we catch params regardless of GET or POST
    const params = Object.assign({}, req.query, req.body);

    console.log('[LAUNCH] Raw params received:', JSON.stringify(params, null, 2));

    // ── Extract standard Docebo parameters ────────────────────────────────
    const userId     = params.user_id     || params.userId     || '';
    const courseId   = params.course_id   || params.courseId   || '';
    const username   = params.username    || '';
    const courseCode = params.course_code || params.courseCode || '';
    const endpoint   = params.endpoint   || '';
    const auth       = params.auth       || '';

    // ── Parse actor JSON string ───────────────────────────────────────────
    // actor = '{"mbox":["mailto:user@company.com"],"name":["Full Name"]}'
    let userEmail = '';
    let userName  = '';

    if (params.actor) {
      try {
        const actor = typeof params.actor === 'string'
          ? JSON.parse(params.actor)
          : params.actor;

        // mbox is an array like ["mailto:user@company.com"]
        const mbox = Array.isArray(actor.mbox) ? actor.mbox[0] : actor.mbox || '';
        userEmail  = mbox.replace('mailto:', '').trim();

        // name is an array like ["Full Name"]
        userName   = Array.isArray(actor.name) ? actor.name[0] : actor.name || username;

      } catch (parseErr) {
        console.warn('[LAUNCH] Could not parse actor JSON:', params.actor, parseErr.message);
        userName = username; // fall back to username param
      }
    } else {
      userName = username;
    }

    console.log(`[LAUNCH] endpoint=${endpoint} | user_id=${userId} | course_id=${courseId}`);
    console.log(`[LAUNCH] username=${username} | course_code=${courseCode}`);
    console.log(`[LAUNCH] actor → email=${userEmail} | name=${userName}`);

    // ── Validate required fields ──────────────────────────────────────────
    if (!userId || !courseId) {
      return res.status(400).json({
        error:   'Missing required parameters: user_id and course_id are required',
        received: Object.keys(params),
      });
    }

    // ── Create signed ElevenLabs session ──────────────────────────────────
    const session = await elevenLabsService.createSignedSession({
      userId,
      courseId,
      userName,
      userEmail,
      courseName: courseCode || `Course ${courseId}`,
    });

    console.log(`[LAUNCH] Session created — conv=${session.conversationId} url=${session.signedUrl}`);

    // ── Redirect learner straight into ElevenLabs ─────────────────────────
    // If Docebo opens this URL in a browser/iframe, the learner lands
    // directly in the ElevenLabs conversational AI interface.
    // If Docebo expects a JSON response instead, comment out the redirect
    // and uncomment the res.json() block below.
    return res.redirect(302, session.signedUrl);

    // ── Alternative: return JSON (use this if Docebo reads the response) ──
    // return res.status(200).json({
    //   success:         true,
    //   elevenlabs_url:  session.signedUrl,
    //   conversation_id: session.conversationId,
    // });

  } catch (err) {
    console.error('[LAUNCH] Error:', err.message, err.stack);
    return res.status(500).json({ error: 'Failed to create ElevenLabs session' });
  }
}

// Handle both GET and POST on /launch
router.get('/launch',  launchHandler);
router.post('/launch', launchHandler);

module.exports = router;
