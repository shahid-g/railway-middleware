const express        = require('express');
const router         = express.Router();
const { verifyWebhookToken } = require('../middleware/auth');
const doceboService  = require('../services/docebo');
const { getSession } = require('../services/elevenlabs');

/**
 * POST /webhooks/elevenlabs/:token/done
 *
 * The :token segment is a secret known only to Railway and ElevenLabs.
 * Configure this full URL in ElevenLabs webhook settings:
 *   https://your-app.up.railway.app/webhooks/elevenlabs/<YOUR_TOKEN>/done
 */
router.post('/done', async (req, res) => {
  // ACK immediately
  res.status(200).json({ received: true });

  try {
    const payload = req.body;
    console.log(`[ElevenLabs Webhook] type=${payload.type}`);

    // Only handle post_call_transcription
    if (payload.type && payload.type !== 'post_call_transcription') {
      console.log(`[ElevenLabs Webhook] Skipping type: ${payload.type}`);
      return;
    }

    // ── Extract from nested data structure ────────────────────────────────
    const data           = payload.data           || payload;
    const conversationId = data.conversation_id;
    const transcript     = data.transcript        || [];
    const metadata       = data.metadata          || {};
    const analysis       = data.analysis          || {};
    const dynamicVars    = data.conversation_initiation_client_data?.dynamic_variables || {};
    const durationSecs   = metadata.call_duration_secs || 0;
    const summary        = analysis.transcript_summary || '';

    console.log(`[ElevenLabs Webhook] conv=${conversationId} duration=${durationSecs}s`);
    console.log('[ElevenLabs Webhook] dynamic_variables raw:', JSON.stringify(dynamicVars));

    // ── Resolve Docebo user/course context ────────────────────────────────
    // Priority 1: dynamic_variables sent at session start
    // Priority 2: in-memory session store
    // Flatten arrays — courseId may arrive as ["5062","5062"] if Docebo sent it as repeated param
    const toScalar = (v) => !v ? null : Array.isArray(v) ? String(v[0]) : String(v);

    let userId   = toScalar(dynamicVars.userId   || dynamicVars.user_id);
    let courseId = toScalar(dynamicVars.courseId || dynamicVars.course_id);

    if ((!userId || !courseId) && conversationId) {
      const stored = getSession(conversationId);
      if (stored) {
        userId   = stored.userId;
        courseId = stored.courseId;
        console.log(`[ElevenLabs Webhook] Context from session store — user=${userId} course=${courseId}`);
      }
    }

    if (!userId || !courseId) {
      console.error('[ElevenLabs Webhook] Cannot update Docebo — userId/courseId missing. conv=' + conversationId);
      return;
    }

    // ── Format transcript ─────────────────────────────────────────────────
    const transcriptText = transcript
      .map(t => `[${(t.role || 'UNKNOWN').toUpperCase()}]: ${t.message || ''}`)
      .join('\n');

    const updatePayload = {
      userId,
      courseId,
      conversationId,
      transcriptText,
      transcriptRaw:  transcript,
      summary,
      scores:         analysis.evaluation_criteria_results || {},
      durationSecs,
      completedAt:    new Date().toISOString(),
    };

    const method = process.env.DOCEBO_UPDATE_METHOD || 'both';

    if (method === 'rest' || method === 'both') {
      try {
        await doceboService.updateViaRestApi(updatePayload);
        console.log(`[ElevenLabs Webhook] ✓ Docebo REST updated — user=${userId} course=${courseId}`);
      } catch (err) {
        console.error('[ElevenLabs Webhook] REST update failed:', err.message);
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
