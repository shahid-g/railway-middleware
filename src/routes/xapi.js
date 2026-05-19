const express           = require('express');
const router            = express.Router();
const elevenLabsService = require('../services/elevenlabs');

// ─────────────────────────────────────────────────────────────────────────────
// POST /course/launch
//
// Plain REST endpoint called by Docebo when a learner opens the course.
// Configure this URL in the Docebo course settings as the launch URL.
//
// Expected JSON body from Docebo (send whichever fields are available):
// {
//   "user_id":     "123",
//   "course_id":   "456",
//   "user_email":  "learner@example.com",
//   "user_name":   "Jane Smith",
//   "course_name": "My Course"
// }
//
// Response:
// {
//   "success": true,
//   "elevenlabs_url": "https://...",
//   "conversation_id": "..."
// }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/launch', async (req, res) => {
  try {
    const body = req.body;
    console.log('[LAUNCH] Request received:', JSON.stringify(body, null, 2));

    // ── Extract fields — accept common Docebo field name variants ─────────
    const userId     = body.user_id     || body.userId     || body.learner_id;
    const courseId   = body.course_id   || body.courseId;
    const userEmail  = body.user_email  || body.email      || '';
    const userName   = body.user_name   || body.username   || body.name || '';
    const courseName = body.course_name || body.courseName || `Course ${courseId}`;

    if (!userId || !courseId) {
      return res.status(400).json({
        error: 'Missing required fields: user_id and course_id must be provided',
      });
    }

    // ── Create signed ElevenLabs session for this learner ─────────────────
    const session = await elevenLabsService.createSignedSession({
      userId,
      courseId,
      userName,
      userEmail,
      courseName,
    });

    console.log(`[LAUNCH] Session created — user=${userId} course=${courseId} conv=${session.conversationId}`);

    return res.status(200).json({
      success:         true,
      elevenlabs_url:  session.signedUrl,
      conversation_id: session.conversationId,
    });

  } catch (err) {
    console.error('[LAUNCH] Error:', err.message, err.stack);
    return res.status(500).json({ error: 'Failed to create ElevenLabs session' });
  }
});

module.exports = router;
