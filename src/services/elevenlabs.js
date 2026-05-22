const axios = require('axios');

const ELEVENLABS_BASE = 'https://api.elevenlabs.io';

// ── In-memory session store ───────────────────────────────────────────────────
// Maps conversationId → { userId, courseId, userName, userEmail, courseName }
// Used to correlate ElevenLabs completion webhook back to the Docebo user/course.
// TTL: 24 hours — sessions older than this are pruned automatically.
const sessionStore = new Map();
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

function storeSession(conversationId, context) {
  sessionStore.set(conversationId, {
    ...context,
    storedAt: Date.now(),
  });
  console.log(`[SessionStore] Stored context for conv=${conversationId} (store size=${sessionStore.size})`);
  pruneExpiredSessions();
}

function getSession(conversationId) {
  return sessionStore.get(conversationId) || null;
}

function pruneExpiredSessions() {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [id, session] of sessionStore.entries()) {
    if (session.storedAt < cutoff) {
      sessionStore.delete(id);
      console.log(`[SessionStore] Pruned expired session conv=${id}`);
    }
  }
}

// ── ElevenLabs HTTP client ────────────────────────────────────────────────────
function elevenLabsClient() {
  return axios.create({
    baseURL: ELEVENLABS_BASE,
    headers: {
      'xi-api-key':   process.env.ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
    },
    timeout: 15000,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// createSignedSession
//
// Gets a signed URL from ElevenLabs — returns it UNMODIFIED (no extra params).
// Stores Docebo context in the in-memory session store keyed by conversationId
// so the completion webhook can look it up later.
// ─────────────────────────────────────────────────────────────────────────────
async function createSignedSession(context) {
  const agentId = process.env.ELEVENLABS_AGENT_ID;
  const apiKey  = process.env.ELEVENLABS_API_KEY;

  if (!apiKey)  throw new Error('ELEVENLABS_API_KEY is not set');
  if (!agentId) throw new Error('ELEVENLABS_AGENT_ID is not set');

  console.log(`[ElevenLabs] Requesting signed URL — agent_id=${agentId}`);

  const client = elevenLabsClient();

  let response;
  try {
    response = await client.get('/v1/convai/conversation/get_signed_url', {
      params: { agent_id: agentId },
    });
  } catch (err) {
    const status = err.response?.status;
    const detail = JSON.stringify(err.response?.data || err.message);
    console.error(`[ElevenLabs] API error ${status}: ${detail}`);
    throw new Error(`ElevenLabs API returned ${status}: ${detail}`);
  }

  // ── Return signed URL completely unmodified ───────────────────────────────
  // DO NOT append any query params — ElevenLabs signed URLs are WebSocket
  // endpoints and extra params will break the connection.
  const signedUrl = response.data?.signed_url;
  if (!signedUrl) {
    throw new Error(`ElevenLabs response missing signed_url. Got: ${JSON.stringify(response.data)}`);
  }

  const conversationId = response.data?.conversation_id || null;

  // ── Store Docebo context in memory keyed by conversationId ─────────────────
  // Used as fallback when the webhook fires and dynamic_variables aren't present.
  if (conversationId) {
    storeSession(conversationId, context);
  } else {
    console.warn('[ElevenLabs] No conversation_id at session creation — will rely on dynamic_variables in webhook');
  }


  console.log(`[ElevenLabs] ✓ Signed URL ready — conv=${conversationId} url=${signedUrl}`);

  return { signedUrl, conversationId };
}

// ─────────────────────────────────────────────────────────────────────────────
// verifyConfig — used by the /test-elevenlabs diagnostic route
// ─────────────────────────────────────────────────────────────────────────────
async function verifyConfig() {
  const agentId = process.env.ELEVENLABS_AGENT_ID;
  const apiKey  = process.env.ELEVENLABS_API_KEY;

  const results = {
    api_key_set:          !!apiKey,
    agent_id_set:         !!agentId,
    agent_id:             agentId  || '(not set)',
    api_key_prefix:       apiKey ? apiKey.slice(0, 8) + '...' : '(not set)',
    agent_reachable:      false,
    signed_url_reachable: false,
    agent_error:          null,
    signed_url_error:     null,
    signed_url_keys:      null,
  };

  if (!apiKey || !agentId) return results;

  const client = elevenLabsClient();

  // Test 1: agent info
  try {
    const r = await client.get(`/v1/convai/agents/${agentId}`);
    results.agent_reachable = true;
    results.agent_name = r.data?.name || r.data?.agent_name || '(unknown)';
  } catch (err) {
    results.agent_error = `${err.response?.status}: ${JSON.stringify(err.response?.data || err.message)}`;
  }

  // Test 2: signed URL
  try {
    const r = await client.get('/v1/convai/conversation/get_signed_url', {
      params: { agent_id: agentId },
    });
    results.signed_url_reachable = true;
    results.signed_url_keys      = Object.keys(r.data || {});
  } catch (err) {
    results.signed_url_error = `${err.response?.status}: ${JSON.stringify(err.response?.data || err.message)}`;
  }

  return results;
}

async function getConversation(conversationId) {
  const client   = elevenLabsClient();
  const response = await client.get(`/v1/convai/conversations/${conversationId}`);
  return response.data;
}

module.exports = { createSignedSession, verifyConfig, getSession, getConversation };
