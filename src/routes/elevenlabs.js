const express   = require('express');
const router    = express.Router();
const { verifyElevenLabsSignature } = require('../middleware/auth');
const doceboService                 = require('../services/docebo');

/**
 * POST /webhooks/elevenlabs/done
 *
 * Fired by ElevenLabs when a Conversational AI session ends.
 * Parses transcript + parameters → updates Docebo via REST API and/or xAPI.
 */
router.post('/done', verifyElevenLabsSignature, async (req, res) => {
  // ACK immediately — ElevenLabs requires a fast 200
  res.status(200).json({ received: true });

  try {
    const payload = req.body;
    console.log('[ElevenLabs] Completion webhook received:', JSON.stringify(payload, null, 2));

    // ── Parse ElevenLabs completion payload ───────────────────────────────
    // Adjust field names to match the exact ElevenLabs webhook schema
    // for your agent version.
    const {
      conversation_id:    conversationId,
      transcript        = [],
      analysis          = {},
      metadata          = {},
      call_duration_secs: durationSecs = 0,
    } = payload;

    // User + course context was embedded in the session metadata at launch time
    const userId   = metadata.userId   || metadata.user_id;
    const courseId = metadata.courseId || metadata.course_id;

    if (!userId || !courseId) {
      console.error('[ElevenLabs] Missing userId/courseId in metadata — cannot update Docebo');
      return;
    }

    // ── Format transcript as readable text ────────────────────────────────
    const transcriptText = transcript
      .map(t => `[${(t.role || 'UNKNOWN').toUpperCase()}]: ${t.message || t.content || ''}`)
      .join('\n');

    const updatePayload = {
      userId,
      courseId,
      conversationId,
      transcriptText,
      transcriptRaw: transcript,
      summary:       analysis.summary || '',
      scores:        analysis.scores  || {},
      durationSecs,
      completedAt:   new Date().toISOString(),
    };

    const method = process.env.DOCEBO_UPDATE_METHOD || 'both';

    // ── Option A: Docebo REST API ─────────────────────────────────────────
    if (method === 'rest' || method === 'both') {
      try {
        await doceboService.updateViaRestApi(updatePayload);
        console.log(`[ElevenLabs] Docebo REST updated — user=${userId} course=${courseId}`);
      } catch (err) {
        console.error('[ElevenLabs] Docebo REST update failed:', err.message);
      }
    }

    // ── Option B: xAPI Statement ──────────────────────────────────────────
    if (method === 'xapi' || method === 'both') {
      try {
        await doceboService.updateViaXapi(updatePayload);
        console.log(`[ElevenLabs] xAPI statement sent — user=${userId} course=${courseId}`);
      } catch (err) {
        console.error('[ElevenLabs] xAPI update failed:', err.message);
      }
    }

  } catch (err) {
    console.error('[ElevenLabs] Completion handler error:', err.message, err.stack);
  }
});

module.exports = router;
