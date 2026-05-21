const express   = require('express');
const router    = express.Router();
const { verifyElevenLabsSignature } = require('../middleware/auth');
const doceboService                 = require('../services/docebo');
const { getSession }                = require('../services/elevenlabs');

/**
 * POST /webhooks/elevenlabs/done
 *
 * Fired by ElevenLabs when a Conversational AI session ends (post_call_transcription).
 *
 * Official ElevenLabs webhook payload structure:
 * {
 *   "type": "post_call_transcription",
 *   "event_timestamp": 1739537297,
 *   "data": {
 *     "agent_id": "...",
 *     "conversation_id": "...",
 *     "status": "done",
 *     "transcript": [ { "role": "agent"|"user", "message": "...", ... } ],
 *     "metadata": { "call_duration_secs": 22, ... },
 *     "analysis": { "transcript_summary": "...", "call_successful": "success", ... },
 *     "conversation_initiation_client_data": { "dynamic_variables": { ... } }
 *   }
 * }
 */
router.post('/done', verifyElevenLabsSignature, async (req, res) => {
  // ACK immediately — ElevenLabs requires a fast 200
  // Note: 4xx errors are NOT retried by ElevenLabs, only 5xx/429/408
  res.status(200).json({ received: true });

  try {
    const payload = req.body;
    console.log('[ElevenLabs Webhook] Received type:', payload.type);
    console.log('[ElevenLabs Webhook] Full payload:', JSON.stringify(payload, null, 2));

    // Only process post_call_transcription events
    if (payload.type && payload.type !== 'post_call_transcription') {
      console.log(`[ElevenLabs Webhook] Ignoring event type: ${payload.type}`);
      return;
    }

    // ── Extract from correct nested structure ─────────────────────────────
    const data           = payload.data           || payload; // fallback if not nested
    const conversationId = data.conversation_id;
    const transcript     = data.transcript        || [];
    const metadata       = data.metadata          || {};
    const analysis       = data.analysis          || {};
    const dynamicVars    = data.conversation_initiation_client_data?.dynamic_variables || {};
    const durationSecs   = metadata.call_duration_secs || 0;
    const summary        = analysis.transcript_summary || '';

    console.log(`[ElevenLabs Webhook] conversation_id=${conversationId} duration=${durationSecs}s`);

    // ── Resolve Docebo user/course context ────────────────────────────────
    // Priority 1: dynamic_variables set at session initiation
    // Priority 2: in-memory session store keyed by conversationId
    let userId   = dynamicVars.userId   || dynamicVars.user_id;
    let courseId = dynamicVars.courseId || dynamicVars.course_id;

    if ((!userId || !courseId) && conversationId) {
      const stored = getSession(conversationId);
      if (stored) {
        userId   = stored.userId;
        courseId = stored.courseId;
        console.log(`[ElevenLabs Webhook] Context from session store — user=${userId} course=${courseId}`);
      }
    }

    if (!userId || !courseId) {
      console.error('[ElevenLabs Webhook] Cannot update Docebo — userId/courseId not resolved.');
      console.error('[ElevenLabs Webhook] dynamic_variables:', JSON.stringify(dynamicVars));
      console.error('[ElevenLabs Webhook] conversationId:', conversationId);
      return;
    }

    // ── Format transcript as readable text ────────────────────────────────
    const transcriptText = transcript
      .map(t => `[${(t.role || 'UNKNOWN').toUpperCase()}]: ${t.message || ''}`)
      .join('\n');

    const updatePayload = {
      userId,
      courseId,
      conversationId,
      transcriptText,
      transcriptRaw: transcript,
      summary,
      scores:        analysis.evaluation_criteria_results || {},
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
