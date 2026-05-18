const express = require('express');
const router = express.Router();
const { verifyElevenLabsSignature } = require('../middleware/auth');
const doceboService = require('../services/docebo');

/**
 * POST /webhooks/elevenlabs/done
 *
 * Triggered by ElevenLabs when a Conversational AI session ends.
 * Responsibilities:
 *  1. Verify the webhook signature
 *  2. Extract transcript + parameters from the payload
 *  3. Update Docebo via REST API and/or xAPI
 */
router.post('/done', verifyElevenLabsSignature, async (req, res) => {
  // Acknowledge immediately — ElevenLabs expects a fast 200 response
  res.status(200).json({ received: true });

  try {
    const payload = req.body;
    console.log('[ELEVENLABS] Completion webhook received:', JSON.stringify(payload, null, 2));

    // ── Parse ElevenLabs payload ───────────────────────────────────────────
    // ElevenLabs Conversational AI webhook schema (adjust to actual API version):
    //
    // payload.type              = "conversation.ended"
    // payload.conversation_id   = "conv_abc123"
    // payload.agent_id          = "agent_xyz"
    // payload.metadata          = { userId, courseId, ... } (set during session creation)
    // payload.transcript        = [{ role: "agent"|"user", message: "...", timestamp: ... }]
    // payload.analysis          = { summary: "...", scores: { ... } }
    // payload.call_duration_secs = 120

    const {
      conversation_id: conversationId,
      transcript = [],
      analysis   = {},
      metadata   = {},
      call_duration_secs: durationSecs = 0,
    } = payload;

    // Retrieve user/course context from metadata (set when session was created)
    const userId   = metadata.userId   || metadata.user_id;
    const courseId = metadata.courseId || metadata.course_id;

    if (!userId || !courseId) {
      console.error('[ELEVENLABS] Cannot update Docebo — missing userId/courseId in metadata');
      return;
    }

    // ── Format transcript as readable text ────────────────────────────────
    const transcriptText = transcript
      .map(t => `[${t.role?.toUpperCase() || 'UNKNOWN'}]: ${t.message || t.content || ''}`)
      .join('\n');

    // ── Build update payload ──────────────────────────────────────────────
    const updatePayload = {
      userId,
      courseId,
      conversationId,
      transcriptText,
      transcriptRaw: transcript,
      summary:       analysis.summary       || '',
      scores:        analysis.scores        || {},
      durationSecs,
      completedAt:   new Date().toISOString(),
    };

    const method = process.env.DOCEBO_UPDATE_METHOD || 'both';

    // ── Option A: Docebo REST API ─────────────────────────────────────────
    if (method === 'rest' || method === 'both') {
      try {
        await doceboService.updateViaRestApi(updatePayload);
        console.log(`[ELEVENLABS] Docebo REST update complete for user=${userId} course=${courseId}`);
      } catch (err) {
        console.error('[ELEVENLABS] Docebo REST update failed:', err.message);
      }
    }

    // ── Option B: xAPI Statement ──────────────────────────────────────────
    if (method === 'xapi' || method === 'both') {
      try {
        await doceboService.updateViaXapi(updatePayload);
        console.log(`[ELEVENLABS] Docebo xAPI statement sent for user=${userId} course=${courseId}`);
      } catch (err) {
        console.error('[ELEVENLABS] Docebo xAPI update failed:', err.message);
      }
    }

  } catch (err) {
    console.error('[ELEVENLABS] Completion handler error:', err.message, err.stack);
  }
});

module.exports = router;
