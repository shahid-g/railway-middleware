const express   = require('express');
const router    = express.Router();
const { verifyElevenLabsSignature } = require('../middleware/auth');
const doceboService                 = require('../services/docebo');
const { getSession, getConversation } = require('../services/elevenlabs');

/**
 * POST /webhooks/elevenlabs/done
 *
 * Fired by ElevenLabs when a Conversational AI session ends.
 * Looks up Docebo user/course context from the in-memory session store
 * (keyed by conversationId) then updates Docebo via REST API and/or xAPI.
 */
router.post('/done', verifyElevenLabsSignature, async (req, res) => {
  // ACK immediately — ElevenLabs requires a fast 200
  res.status(200).json({ received: true });

  try {
    const payload = req.body;
    console.log('[ElevenLabs Webhook] Received:', JSON.stringify(payload, null, 2));

    const {
      conversation_id:     conversationId,
      transcript         = [],
      analysis           = {},
      call_duration_secs:  durationSecs = 0,
    } = payload;

    // ── Resolve Docebo context ────────────────────────────────────────────
    // Priority 1: payload.metadata (if ElevenLabs echoes it back)
    // Priority 2: in-memory session store (keyed by conversationId)
    // Priority 3: fetch full conversation from ElevenLabs API
    let userId   = payload.metadata?.userId   || payload.metadata?.user_id;
    let courseId = payload.metadata?.courseId || payload.metadata?.course_id;

    if ((!userId || !courseId) && conversationId) {
      const stored = getSession(conversationId);
      if (stored) {
        userId   = stored.userId;
        courseId = stored.courseId;
        console.log(`[ElevenLabs Webhook] Context from session store — user=${userId} course=${courseId}`);
      }
    }

    if ((!userId || !courseId) && conversationId) {
      // Last resort: fetch full conversation from ElevenLabs API
      try {
        console.log(`[ElevenLabs Webhook] Fetching full conversation from API — conv=${conversationId}`);
        const conv = await getConversation(conversationId);
        userId   = conv?.metadata?.userId   || conv?.metadata?.user_id   || userId;
        courseId = conv?.metadata?.courseId || conv?.metadata?.course_id || courseId;
      } catch (fetchErr) {
        console.warn('[ElevenLabs Webhook] Could not fetch conversation from API:', fetchErr.message);
      }
    }

    if (!userId || !courseId) {
      console.error('[ElevenLabs Webhook] Cannot update Docebo — userId/courseId not resolved. Conv:', conversationId);
      return;
    }

    // ── Format transcript ─────────────────────────────────────────────────
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

    if (method === 'rest' || method === 'both') {
      try {
        await doceboService.updateViaRestApi(updatePayload);
        console.log(`[ElevenLabs Webhook] ✓ Docebo REST updated — user=${userId} course=${courseId}`);
      } catch (err) {
        console.error('[ElevenLabs Webhook] Docebo REST update failed:', err.message);
      }
    }

    if (method === 'xapi' || method === 'both') {
      try {
        await doceboService.updateViaXapi(updatePayload);
        console.log(`[ElevenLabs Webhook] ✓ xAPI statement sent — user=${userId} course=${courseId}`);
      } catch (err) {
        console.error('[ElevenLabs Webhook] xAPI update failed:', err.message);
      }
    }

  } catch (err) {
    console.error('[ElevenLabs Webhook] Handler error:', err.message, err.stack);
  }
});

module.exports = router;
