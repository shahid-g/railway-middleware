const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

// ── OAuth2 token cache ────────────────────────────────────────────────────────
let _tokenCache = { token: null, expiresAt: 0 };

async function getDoceboToken() {
  if (_tokenCache.token && Date.now() < _tokenCache.expiresAt) {
    return _tokenCache.token;
  }

  const base   = process.env.DOCEBO_BASE_URL;
  const id     = process.env.DOCEBO_CLIENT_ID;
  const secret = process.env.DOCEBO_CLIENT_SECRET;

  if (!base || !id || !secret) {
    throw new Error('Missing Docebo credentials (DOCEBO_BASE_URL / DOCEBO_CLIENT_ID / DOCEBO_CLIENT_SECRET)');
  }

  const params = new URLSearchParams({
    grant_type:    'client_credentials',
    client_id:     id,
    client_secret: secret,
  });

  const response = await axios.post(
    `${base}/oauth2/token`,
    params.toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10000 }
  );

  const { access_token, expires_in } = response.data;
  _tokenCache = {
    token:     access_token,
    expiresAt: Date.now() + (expires_in - 60) * 1000,
  };

  console.log('[Docebo] OAuth2 token refreshed');
  return access_token;
}

async function doceboClient() {
  const token = await getDoceboToken();
  return axios.create({
    baseURL: process.env.DOCEBO_BASE_URL,
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    timeout: 15000,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Option A — Update Docebo via REST API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Marks the enrollment complete and stores transcript + metadata
 * in Docebo custom additional_fields.
 *
 * Adjust the endpoint path and field key names to match your
 * Docebo API version and custom field configuration.
 */
async function updateViaRestApi({
  userId,
  courseId,
  conversationId,
  transcriptText,
  summary,
  scores,
  durationSecs,
  completedAt,
}) {
  const client = await doceboClient();

  // 1. Mark enrollment as completed
  await client.put(`/api/lms/v1/enrollment/${courseId}/user/${userId}`, {
    status:        'completed',
    completion_at: completedAt,
  });

  // 2. Write transcript + ElevenLabs metadata to custom fields
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
// Option B — Update Docebo via xAPI Statement (write-back to Docebo LRS)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sends a "completed" xAPI statement to Docebo's LRS endpoint,
 * carrying the full transcript and metadata in result.extensions.
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
    throw new Error('Missing xAPI config (XAPI_ENDPOINT or XAPI_KEY)');
  }

  const statement = {
    id:        uuidv4(),
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
      success:    true,
      completion: true,
      duration:   formatIsoDuration(durationSecs),
      response:   transcriptText,
      extensions: {
        'https://elevenlabs.io/xapi/conversation-id': conversationId,
        'https://elevenlabs.io/xapi/transcript':      transcriptRaw,
        'https://elevenlabs.io/xapi/summary':         summary,
        'https://elevenlabs.io/xapi/scores':          scores,
      },
    },

    context: {
      platform: 'ElevenLabs Conversational AI',
      extensions: {
        'https://docebo.com/xapi/course-id': courseId,
        'https://docebo.com/xapi/user-id':   userId,
      },
    },
  };

  await axios.post(
    `${endpoint}/statements`,
    statement,
    {
      headers: {
        Authorization:               `Basic ${apiKey}`,
        'Content-Type':              'application/json',
        'X-Experience-API-Version':  '1.0.3',
      },
      timeout: 15000,
    }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper
// ─────────────────────────────────────────────────────────────────────────────
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

module.exports = { updateViaRestApi, updateViaXapi };
