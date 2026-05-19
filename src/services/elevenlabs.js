const axios = require('axios');

const ELEVENLABS_BASE = 'https://api.elevenlabs.io';

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

/**
 * Creates a signed ElevenLabs Conversational AI session URL.
 *
 * Correct endpoint (singular "conversation", underscore):
 *   GET /v1/convai/conversation/get_signed_url?agent_id=<id>
 *
 * @param {{ userId, courseId, userName, userEmail, courseName }} context
 * @returns {Promise<{ signedUrl: string, conversationId: string|null }>}
 */
async function createSignedSession(context) {
  const agentId = process.env.ELEVENLABS_AGENT_ID;
  const apiKey  = process.env.ELEVENLABS_API_KEY;

  if (!apiKey)   throw new Error('ELEVENLABS_API_KEY is not set in environment variables');
  if (!agentId)  throw new Error('ELEVENLABS_AGENT_ID is not set in environment variables');

  console.log(`[ElevenLabs] Requesting signed URL for agent_id=${agentId}`);

  const client = elevenLabsClient();

  let response;
  try {
    response = await client.get('/v1/convai/conversation/get_signed_url', {
      params: { agent_id: agentId },
    });
  } catch (err) {
    // Surface the full ElevenLabs error for easier debugging
    const status  = err.response?.status;
    const detail  = JSON.stringify(err.response?.data || err.message);
    console.error(`[ElevenLabs] API error ${status}: ${detail}`);
    console.error(`[ElevenLabs] Full URL attempted: ${ELEVENLABS_BASE}/v1/convai/conversation/get_signed_url?agent_id=${agentId}`);
    throw new Error(`ElevenLabs API returned ${status}: ${detail}`);
  }

  console.log('[ElevenLabs] Raw response:', JSON.stringify(response.data, null, 2));

  const signedUrl = response.data?.signed_url;
  if (!signedUrl) {
    throw new Error(`ElevenLabs response missing signed_url. Full response: ${JSON.stringify(response.data)}`);
  }

  const conversationId = response.data?.conversation_id || null;
  const urlWithMeta    = appendMetadata(signedUrl, context);

  console.log(`[ElevenLabs] ✓ Signed URL obtained. conversation_id=${conversationId}`);

  return { signedUrl: urlWithMeta, conversationId };
}

/**
 * Appends Docebo user/course context as metadata query params on the signed URL.
 * ElevenLabs echoes these back in the completion webhook under payload.metadata.
 */
function appendMetadata(signedUrl, context) {
  try {
    const url = new URL(signedUrl);
    url.searchParams.set('metadata[userId]',   String(context.userId));
    url.searchParams.set('metadata[courseId]', String(context.courseId));
    if (context.userName)   url.searchParams.set('metadata[userName]',   context.userName);
    if (context.userEmail)  url.searchParams.set('metadata[userEmail]',  context.userEmail);
    if (context.courseName) url.searchParams.set('metadata[courseName]', context.courseName);
    return url.toString();
  } catch (e) {
    console.warn('[ElevenLabs] Could not append metadata to signed URL:', e.message);
    return signedUrl; // return as-is rather than failing
  }
}

/**
 * Verifies that the API key and Agent ID are valid by calling the agent info endpoint.
 * Used by the /test-elevenlabs diagnostic route.
 */
async function verifyConfig() {
  const agentId = process.env.ELEVENLABS_AGENT_ID;
  const apiKey  = process.env.ELEVENLABS_API_KEY;

  const results = {
    api_key_set:   !!apiKey,
    agent_id_set:  !!agentId,
    agent_id:      agentId || '(not set)',
    api_key_prefix: apiKey ? apiKey.slice(0, 8) + '...' : '(not set)',
    agent_reachable: false,
    signed_url_reachable: false,
    agent_error: null,
    signed_url_error: null,
    signed_url_response: null,
  };

  if (!apiKey || !agentId) return results;

  const client = elevenLabsClient();

  // Test 1: Can we reach the agent info endpoint?
  try {
    const agentRes = await client.get(`/v1/convai/agents/${agentId}`);
    results.agent_reachable = true;
    results.agent_name = agentRes.data?.name || agentRes.data?.agent_name || '(unknown)';
  } catch (err) {
    results.agent_error = `${err.response?.status}: ${JSON.stringify(err.response?.data || err.message)}`;
  }

  // Test 2: Can we get a signed URL?
  try {
    const urlRes = await client.get('/v1/convai/conversation/get_signed_url', {
      params: { agent_id: agentId },
    });
    results.signed_url_reachable = true;
    results.signed_url_response  = Object.keys(urlRes.data || {});
  } catch (err) {
    results.signed_url_error = `${err.response?.status}: ${JSON.stringify(err.response?.data || err.message)}`;
  }

  return results;
}

/**
 * Fetches full conversation details from ElevenLabs by conversation ID.
 */
async function getConversation(conversationId) {
  const client   = elevenLabsClient();
  const response = await client.get(`/v1/convai/conversations/${conversationId}`);
  return response.data;
}

module.exports = { createSignedSession, verifyConfig, getConversation };
