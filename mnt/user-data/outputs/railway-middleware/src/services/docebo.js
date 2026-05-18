const axios = require('axios');

// ── Docebo OAuth2 token cache ──────────────────────────────────────────────
let _tokenCache = { token: null, expiresAt: 0 };

/**
 * Fetches (and caches) a Docebo OAuth2 access token using client_credentials.
 */
async function getDoceboToken() {
  if (_tokenCache.token && Date.now() < _tokenCache.expiresAt) {
    return _tokenCache.token;
  }

  const base   = process.env.DOCEBO_BASE_URL;
  const id     = process.env.DOCEBO_CLIENT_ID;
  const secret = process.env.DOCEBO_CLIENT_SECRET;

  if (!base || !id || !secret) {
    throw new Error('Missing Docebo credentials (DOCEBO_BASE_URL, DOCEBO_CLIENT_ID, DOCEBO_CLIENT_SECRET)');
  }

  const params = new URLSearchParams({
    grant_type:    'client_credentials',
    client_id:     id,
    client_secret: secret,
  });

  const response = await axios.post(`${base}/oauth2/token`, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 10000,
  });

  const { access_token, expires_in } = response.data;
  _tokenCache = {
    token:     access_token,
    expiresAt: Date.now() + (expires_in - 60) * 1000, // refresh 60s early
  };

  console.log('[DOCEBO] OAuth2 token refreshed');
  return access_token;
}

/**
 * Returns an axios instance authenticated against Docebo.
 */
async function doceboClient() {
  const token = await getDoceboToken();
  return axios.create({
    baseURL: process.env.DOCEBO_BASE_URL,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    timeout: 15000,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase A helper: store the ElevenLabs session URL back in Docebo
// (so the course page can surface the launch link to the learner)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Writes the ElevenLabs signed URL + conversation ID into a Docebo custom field
 * on the course enrollment record.
 *
 * Adjust the endpoint and field names to match your Docebo schema.
 *
 * @param {object} params
 * @param {string} params.userId
 * @param {string} params.courseId
 * @param {string} params.sessionUrl
 * @param {string} params.conversationId
 */
async function updateCourseSessionUrl({ userId, courseId, sessionUrl, conversationId }) {
  const client = await doceboClient();

  // Example: update the enrollment additional_fields
  // Endpoint may vary — check your Docebo API version and custom field IDs
  await client.put(`/api/lms/v1/enrollment/${courseId}/user/${userId}`, {
    additional_fields: [
      { key: 'elevenlabs_session_url',     value: sessionUrl },
      { key: 'elevenlabs_conversation_id', value: conversationId || '' },
    ],
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase C — Option A: Update Docebo via REST API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Updates the Docebo enrollment record with the ElevenLabs transcript and scores.
 * Uses two calls:
 *   1. Mark the enrollment as completed (if not already)
 *   2. Write transcript + metadata to custom additional_fields
 *
 * @param {object} params
 */
async function updateViaRestApi({
  userId,
  courseId,
  conversationId,
  transcriptText,
  transcriptRaw,
  summary,
  scores,
  durationSecs,
  completedAt,
}) {
  const client = await doceboClient();

  // 1. Mark enrollment complete
  await client.put(`/api/lms/v1/enrollment/${courseId}/user/${userId}`, {
    status:        'completed',
    completion_at: completedAt,
  });

  // 2. Store transcript and metadata in custom fields
  // Trim transcript to 5000 chars if Docebo field has a size limit
  const transcriptTrimmed = transcriptText.length > 5000
    ? transcriptText.slice(0, 4990) + '…'
    : transcriptText;

  await client.put(`/api/lms/v1/enrollment/${courseId}/user/${userId}`, {
    additional_fields: [
      { key: 'elevenlabs_conversation_id', value: conversationId || '' },
      { key: 'elevenlabs_transcript',      value: transcriptTrimmed },
      { key: 'elevenlabs_summary',         value: summary || '' },
      { key: 'elevenlabs_duration_secs',   value: String(durationSecs) },
      { key: 'elevenlabs_completed_at',    value: completedAt },
      { key: 'elevenlabs_scores',          value: JSON.stringify(scores) },
    ],
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase C — Option B: Update Docebo via xAPI Statement
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sends an xAPI statement to Docebo's LRS endpoint.
 *
 * Statement structure:
 *   Actor  — the learner (identified by Docebo user email or account)
 *   Verb   — http://adlnet.gov/expapi/verbs/completed
 *   Object — the Docebo course (identified by its ID URL)
 *   Result — success, response (transcript), duration
 *   Extensions — full transcript JSON, conversation ID, scores
 *
 * @param {object} params
 */
async function updateViaXapi({
  userId,
  courseId,
  conversationId,
  transcriptText,
  transcriptRaw,
  summary,
  scores,
  durationSecs,
  completedAt,
}) {
  const endpoint = process.env.XAPI_ENDPOINT;
  const apiKey   = process.env.XAPI_KEY;

  if (!endpoint || !apiKey) {
    throw new Error('Missing xAPI config (XAPI_ENDPOINT, XAPI_KEY)');
  }

  // Format ISO 8601 duration (PT2M30S style) from seconds
  const duration = formatIsoDuration(durationSecs);

  const statement = {
    id:        require('uuid').v4(),
    timestamp: completedAt,

    actor: {
      objectType: 'Agent',
      account: {
        homePage: process.env.DOCEBO_BASE_URL,
        name:     String(userId),
      },
    },

    verb: {
      id:      'http://adlnet.gov/expapi/verbs/completed',
      display: { 'en-US': 'completed' },
    },

    object: {
      objectType: 'Activity',
      id:         `${process.env.DOCEBO_BASE_URL}/course/${courseId}`,
      definition: {
        type: 'http://adlnet.gov/expapi/activities/course',
        name: { 'en-US': `Docebo Course ${courseId}` },
      },
    },

    result: {
      success:      true,
      completion:   true,
      duration,
      response:     transcriptText,
      extensions: {
        'https://elevenlabs.io/xapi/extensions/conversation-id': conversationId,
        'https://elevenlabs.io/xapi/extensions/transcript':      transcriptRaw,
        'https://elevenlabs.io/xapi/extensions/summary':         summary,
        'https://elevenlabs.io/xapi/extensions/scores':          scores,
      },
    },

    context: {
      platform: 'ElevenLabs Conversational AI',
      extensions: {
        'https://docebo.com/xapi/extensions/course-id': courseId,
        'https://docebo.com/xapi/extensions/user-id':   userId,
      },
    },
  };

  await axios.post(
    `${endpoint}/statements`,
    statement,
    {
      headers: {
        Authorization:     `Basic ${apiKey}`,
        'Content-Type':    'application/json',
        'X-Experience-API-Version': '1.0.3',
      },
      timeout: 15000,
    }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Converts seconds to ISO 8601 duration format (e.g. 150 → "PT2M30S").
 * Required by the xAPI spec for result.duration.
 */
function formatIsoDuration(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  let iso = 'PT';
  if (h) iso += `${h}H`;
  if (m) iso += `${m}M`;
  if (s || (!h && !m)) iso += `${s}S`;
  return iso;
}

module.exports = {
  updateCourseSessionUrl,
  updateViaRestApi,
  updateViaXapi,
};
