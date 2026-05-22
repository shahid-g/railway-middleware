const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

// ── OAuth2 token cache ────────────────────────────────────────────────────────
let _tokenCache = { token: null, expiresAt: 0 };

/**
 * Step 1 — Get Docebo access token via POST /oauth2/token
 *
 * Credentials sent as form data (application/x-www-form-urlencoded):
 *   client_id, client_secret, grant_type, scope, username, password
 *
 * Required env vars:
 *   DOCEBO_BASE_URL, DOCEBO_CLIENT_ID, DOCEBO_CLIENT_SECRET,
 *   DOCEBO_GRANT_TYPE  (default: password)
 *   DOCEBO_SCOPE       (default: api)
 *   DOCEBO_USERNAME
 *   DOCEBO_PASSWORD
 */
async function getAccessToken() {
  // Return cached token if still valid (refresh 60s early)
  if (_tokenCache.token && Date.now() < _tokenCache.expiresAt) {
    return _tokenCache.token;
  }

  const base   = process.env.DOCEBO_BASE_URL;
  const id     = process.env.DOCEBO_CLIENT_ID;
  const secret = process.env.DOCEBO_CLIENT_SECRET;
  const grant  = process.env.DOCEBO_GRANT_TYPE  || 'password';
  const scope  = process.env.DOCEBO_SCOPE        || 'api';
  const uname  = process.env.DOCEBO_USERNAME;
  const pwd    = process.env.DOCEBO_PASSWORD;

  if (!base || !id || !secret || !uname || !pwd) {
    throw new Error(
      'Missing Docebo credentials. Required: DOCEBO_BASE_URL, DOCEBO_CLIENT_ID, ' +
      'DOCEBO_CLIENT_SECRET, DOCEBO_USERNAME, DOCEBO_PASSWORD'
    );
  }

  const formData = new URLSearchParams({
    client_id:     id,
    client_secret: secret,
    grant_type:    grant,
    scope,
    username:      uname,
    password:      pwd,
  });

  console.log(`[Docebo] Requesting access token from ${base}/oauth2/token`);

  let response;
  try {
    response = await axios.post(
      `${base}/oauth2/token`,
      formData.toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 15000,
      }
    );
  } catch (err) {
    const status = err.response?.status;
    const detail = JSON.stringify(err.response?.data || err.message);
    throw new Error(`Docebo token request failed (${status}): ${detail}`);
  }

  const { access_token, expires_in } = response.data;
  if (!access_token) {
    throw new Error(`Docebo token response missing access_token: ${JSON.stringify(response.data)}`);
  }

  // Cache token — refresh 60s before expiry
  _tokenCache = {
    token:     access_token,
    expiresAt: Date.now() + ((expires_in || 3600) - 60) * 1000,
  };

  console.log('[Docebo] ✓ Access token obtained');
  return access_token;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2 — Update enrollment via PUT /learn/v1/enrollments/{course_id}/{user_id}
//
// Required env vars:
//   DOCEBO_BASE_URL         — base URL
//   DOCEBO_TRANSCRIPT_FIELD — enrollment field ID to store the transcript
//                             e.g. "transcript" or a numeric ID like "12"
//
// Optional env vars:
//   DOCEBO_SUMMARY_FIELD    — field ID to store the AI summary (if needed)
//   DOCEBO_DURATION_FIELD   — field ID to store call duration in seconds
//   DOCEBO_CONV_ID_FIELD    — field ID to store the ElevenLabs conversation ID
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Updates a Docebo enrollment with transcript and metadata from ElevenLabs.
 *
 * @param {object} params
 * @param {string} params.userId
 * @param {string} params.courseId
 * @param {string} params.transcriptText   — formatted transcript string
 * @param {string} params.conversationId   — ElevenLabs conversation ID
 * @param {string} params.summary          — AI summary from ElevenLabs analysis
 * @param {number} params.durationSecs     — call duration in seconds
 * @param {string} params.completedAt      — ISO timestamp of completion
 */
async function updateViaRestApi({
  userId,
  courseId,
  transcriptText,
  conversationId,
  summary,
  durationSecs,
  completedAt,
}) {
  const base = process.env.DOCEBO_BASE_URL;

  // Strip surrounding quotes in case Railway variables were set with "value"
  const stripQuotes = (v) => v ? v.replace(/^["']|["']$/g, '').trim() : null;

  const transcriptField = stripQuotes(process.env.DOCEBO_TRANSCRIPT_FIELD);
  const summaryField    = stripQuotes(process.env.DOCEBO_SUMMARY_FIELD);
  const durationField   = stripQuotes(process.env.DOCEBO_DURATION_FIELD);
  const convIdField     = stripQuotes(process.env.DOCEBO_CONV_ID_FIELD);

  if (!transcriptField) {
    throw new Error('DOCEBO_TRANSCRIPT_FIELD env var is not set (current value: ' + JSON.stringify(process.env.DOCEBO_TRANSCRIPT_FIELD) + ')');
  }

  // ── Get fresh access token ────────────────────────────────────────────────
  const token = await getAccessToken();

  // ── Build enrollment_fields payload ──────────────────────────────────────
  const enrollmentFields = {};

  // Always write transcript
  enrollmentFields[transcriptField] = transcriptText || '';

  // Write optional fields only if env vars are configured
  if (summaryField  && summary)         enrollmentFields[summaryField]  = summary;
  if (durationField && durationSecs)    enrollmentFields[durationField] = String(durationSecs);
  if (convIdField   && conversationId)  enrollmentFields[convIdField]   = conversationId;

  const body = { enrollment_fields: enrollmentFields };

  console.log(`[Docebo] Updating enrollment — course=${courseId} user=${userId}`);

  let response;
  try {
    response = await axios.put(
      `${base}/learn/v1/enrollments/${courseId}/${userId}`,
      body,
      {
        headers: {
          Authorization:  `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );
  } catch (err) {
    const status = err.response?.status;
    const detail = JSON.stringify(err.response?.data || err.message);
    throw new Error(`Docebo enrollment update failed (${status}): ${detail}`);
  }

  console.log('[Docebo] ✓ Enrollment updated');
  return response.data;
}

// ─────────────────────────────────────────────────────────────────────────────
// xAPI write-back (optional — only called if DOCEBO_UPDATE_METHOD includes xapi)
// ─────────────────────────────────────────────────────────────────────────────
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
    throw new Error('Missing xAPI config: XAPI_ENDPOINT and XAPI_KEY are required');
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
        name: { 'en-US': `Course ${courseId}` },
      },
    },
    result: {
      success:    true,
      completion: true,
      duration:   formatIsoDuration(durationSecs),
      response:   transcriptText,
      extensions: {
        'https://elevenlabs.io/xapi/conversation-id': conversationId,
        'https://elevenlabs.io/xapi/summary':         summary,
        'https://elevenlabs.io/xapi/scores':          scores,
      },
    },
  };

  await axios.post(`${endpoint}/statements`, statement, {
    headers: {
      Authorization:              `Basic ${apiKey}`,
      'Content-Type':             'application/json',
      'X-Experience-API-Version': '1.0.3',
    },
    timeout: 15000,
  });
}

function formatIsoDuration(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  let iso = 'PT';
  if (h) iso += `${h}H`;
  if (m) iso += `${m}M`;
  if (s || (!h && !m)) iso += `${s}S`;
  return iso;
}

module.exports = { updateViaRestApi, updateViaXapi };
