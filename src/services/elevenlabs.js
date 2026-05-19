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
 * Creates a signed ElevenLabs Conversational AI session URL for a learner.
 *
 * The signed URL lets the learner access the agent without exposing the API key.
 * User + course context is embedded as metadata so ElevenLabs includes it in the
 * completion webhook, allowing Railway to correlate the session back to Docebo.
 *
 * ElevenLabs API: GET /v1/convai/conversations/get-signed-url?agent_id=<id>
 *
 * @param {{ userId, courseId, userName, userEmail, courseName }} context
 * @returns {Promise<{ signedUrl: string, conversationId: string|null }>}
 */
async function createSignedSession(context) {
  const agentId = process.env.ELEVENLABS_AGENT_ID;
  if (!agentId) throw new Error('ELEVENLABS_AGENT_ID is not set');

  const client   = elevenLabsClient();
  const response = await client.get('/v1/convai/conversations/get-signed-url', {
    params: { agent_id: agentId },
  });

  const signedUrl = response.data?.signed_url;
  if (!signedUrl) throw new Error('ElevenLabs did not return a signed_url');

  const conversationId = response.data?.conversation_id || null;

  // Append Docebo context as metadata query params.
  // ElevenLabs will echo these back in the completion webhook under payload.metadata.
  const urlWithMeta = appendMetadata(signedUrl, context);

  return { signedUrl: urlWithMeta, conversationId };
}

function appendMetadata(signedUrl, context) {
  const url = new URL(signedUrl);
  url.searchParams.set('metadata[userId]',   String(context.userId));
  url.searchParams.set('metadata[courseId]', String(context.courseId));
  if (context.userName)   url.searchParams.set('metadata[userName]',   context.userName);
  if (context.userEmail)  url.searchParams.set('metadata[userEmail]',  context.userEmail);
  if (context.courseName) url.searchParams.set('metadata[courseName]', context.courseName);
  return url.toString();
}

/**
 * Fetches full conversation details from ElevenLabs by ID.
 * Useful if the webhook payload is incomplete and you need to re-fetch.
 */
async function getConversation(conversationId) {
  const client   = elevenLabsClient();
  const response = await client.get(`/v1/convai/conversations/${conversationId}`);
  return response.data;
}

module.exports = { createSignedSession, getConversation };
