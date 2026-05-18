const express = require('express');
const router = express.Router();
const { verifyDoceboSignature } = require('../middleware/auth');
const elevenLabsService = require('../services/elevenlabs');
const doceboService = require('../services/docebo');

/**
 * POST /webhooks/docebo/course-start
 *
 * Triggered by Docebo when a user initiates a course.
 * Responsibilities:
 *  1. Verify the request is genuinely from Docebo
 *  2. Extract user + course context
 *  3. Create a signed ElevenLabs session for this user
 *  4. Return (or push back) the session URL so the user can launch the ElevenLabs UI
 */
router.post('/course-start', verifyDoceboSignature, async (req, res) => {
  try {
    const payload = req.body;
    console.log('[DOCEBO] Course start received:', JSON.stringify(payload, null, 2));

    // ── Extract fields from Docebo webhook payload ─────────────────────────
    // Adjust field names to match your actual Docebo webhook schema
    const userId     = payload.user_id     || payload.userId     || payload.learner_id;
    const courseId   = payload.course_id   || payload.courseId;
    const courseName = payload.course_name || payload.courseName || 'Unknown Course';
    const userEmail  = payload.user_email  || payload.email;
    const userName   = payload.username    || payload.user_name  || payload.name;

    if (!userId || !courseId) {
      console.error('[DOCEBO] Missing required fields: user_id or course_id');
      return res.status(400).json({ error: 'Missing user_id or course_id in payload' });
    }

    // ── Create ElevenLabs signed session URL ───────────────────────────────
    // Pass user context so ElevenLabs can personalise the session and
    // include it in the completion webhook payload for correlation later.
    const session = await elevenLabsService.createSignedSession({
      userId,
      courseId,
      userName,
      userEmail,
      courseName,
    });

    console.log(`[DOCEBO] ElevenLabs session created for user=${userId} course=${courseId}`);
    console.log(`[DOCEBO] Session URL: ${session.signedUrl}`);

    // ── Respond to Docebo ─────────────────────────────────────────────────
    // Return the signed URL. How you surface this to the learner depends on
    // your Docebo setup — options:
    //   a) Docebo reads the response and redirects the user
    //   b) You update a Docebo custom field with the URL via REST API
    //   c) The course content page polls this endpoint
    //
    // Option (b) — update a custom field with the launch URL:
    try {
      await doceboService.updateCourseSessionUrl({
        userId,
        courseId,
        sessionUrl: session.signedUrl,
        conversationId: session.conversationId,
      });
    } catch (updateErr) {
      // Non-fatal — log but still return the URL
      console.warn('[DOCEBO] Could not update session URL back to Docebo:', updateErr.message);
    }

    return res.status(200).json({
      success: true,
      elevenlabs_url: session.signedUrl,
      conversation_id: session.conversationId,
    });

  } catch (err) {
    console.error('[DOCEBO] course-start handler error:', err.message);
    return res.status(500).json({ error: 'Failed to create ElevenLabs session' });
  }
});

module.exports = router;
