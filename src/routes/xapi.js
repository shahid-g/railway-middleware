const express           = require('express');
const router            = express.Router();
const elevenLabsService = require('../services/elevenlabs');

// ─────────────────────────────────────────────────────────────────────────────
// GET  /launch        → https://your-app.up.railway.app/launch
// POST /launch        → https://your-app.up.railway.app/launch
// GET  /course/launch → https://your-app.up.railway.app/course/launch
// POST /course/launch → https://your-app.up.railway.app/course/launch
//
// Docebo sends these query/form parameters:
//   endpoint    - LRS endpoint (informational)
//   auth        - auth token (informational)
//   user_id     - Docebo user ID
//   course_id   - Docebo course ID
//   username    - learner username
//   course_code - course reference code
//   actor       - JSON string e.g. {"mbox":["mailto:user@co.com"],"name":["Full Name"]}
// ─────────────────────────────────────────────────────────────────────────────

async function launchHandler(req, res) {
  try {
    // Merge query string + body — works for GET and POST
    const params = Object.assign({}, req.query, req.body);

    console.log(`[LAUNCH] ${req.method} ${req.originalUrl}`);
    console.log('[LAUNCH] Params:', JSON.stringify(params, null, 2));

    // ── Extract Docebo parameters ─────────────────────────────────────────
    const userId     = params.user_id     || params.userId     || '';
    const courseId   = params.course_id   || params.courseId   || '';
    const username   = params.username    || '';
    const courseCode = params.course_code || params.courseCode || '';
    const endpoint   = params.endpoint   || '';
    const auth       = params.auth       || '';

    // ── Parse actor JSON ──────────────────────────────────────────────────
    // Docebo sends: {"mbox":["mailto:user@company.com"],"name":["Full Name"]}
    let userEmail = '';
    let userName  = username;

    if (params.actor) {
      try {
        const actor = typeof params.actor === 'string'
          ? JSON.parse(params.actor)
          : params.actor;

        // mbox array → strip "mailto:" prefix
        const mboxRaw = Array.isArray(actor.mbox) ? actor.mbox[0] : (actor.mbox || '');
        userEmail     = mboxRaw.replace('mailto:', '').trim();

        // name array → first element
        userName = Array.isArray(actor.name)
          ? actor.name[0]
          : (actor.name || username);

      } catch (e) {
        console.warn('[LAUNCH] Failed to parse actor — using fallback:', e.message);
      }
    }

    console.log(`[LAUNCH] → user_id=${userId} | course_id=${courseId} | email=${userEmail} | name=${userName} | course_code=${courseCode}`);

    // ── Validate required fields ──────────────────────────────────────────
    if (!userId || !courseId) {
      console.error('[LAUNCH] Missing user_id or course_id. Received keys:', Object.keys(params));
      return res.status(400).json({
        error:          'Missing required parameters: user_id and course_id',
        received_keys:  Object.keys(params),
      });
    }

    // ── Create ElevenLabs signed session ──────────────────────────────────
    const session = await elevenLabsService.createSignedSession({
      userId,
      courseId,
      userName,
      userEmail,
      courseName: courseCode || `Course ${courseId}`,
    });

    console.log(`[LAUNCH] ✓ Session created — conv=${session.conversationId}`);

    // ── Redirect learner into ElevenLabs ──────────────────────────────────
    // 302 redirect sends the learner's browser straight to ElevenLabs.
    // If Docebo instead reads the response body, comment out the redirect
    // and uncomment the JSON block below.
    return res.redirect(302, session.signedUrl);

    // ── JSON response alternative (comment out redirect above to use) ─────
    // return res.status(200).json({
    //   success:         true,
    //   elevenlabs_url:  session.signedUrl,
    //   conversation_id: session.conversationId,
    // });

  } catch (err) {
    console.error('[LAUNCH] Error:', err.message, err.stack);
    return res.status(500).json({ error: 'Failed to create ElevenLabs session', detail: err.message });
  }
}

// Register both paths — Express strips the mount prefix so we only need /launch here
router.get('/launch',  launchHandler);
router.post('/launch', launchHandler);

module.exports = router;
