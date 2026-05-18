const axios = require('axios');

const ELEVENLABS_BASE = 'https://api.elevenlabs.io';

/**
 * Returns an axios instance pre-configured with the ElevenLabs API key.
 */
function elevenLabsClient() {
  return axios.create({
    baseURL: ELEVENLABS_BASE,
    headers: {
      'xi-api-key': process.env.ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
    },
    timeout: 15000,
  });
}

/**
 * Creates a signed ElevenLabs Conversational AI session URL for a specific user.
 *
 * The signed URL allows the learner to access the ElevenLabs agent interface
 * without exposing your API key in the browser.
 *
 * ElevenLabs API reference:
 *   GET /v1/convai/conversations/get-signed-url?agent_id=<id>
 *
 * @param {object} context
 * @param {string} context.userId     - Docebo user ID
 * @param {string} context.courseId   - Docebo course ID
 * @param {string} context.userName   - Learner display name
 * @param {string} context.userEmail  - Learner email
 * @param {string} context.courseName - Course title
 *
 * @returns {Promise<{ signedUrl: string, conversationId: string }>}
 */
async function createSignedSession(context) {
  const agentId = process.env.ELEVENLABS_AGENT_ID;
  if (!agentId) throw new Error('ELEVENLABS_AGENT_ID environment variable is not set');

  const client = elevenLabsClient();

  // Get a signed URL for the agent
  // The metadata object will be included in the completion webhook payload,
  // allowing us to correlate the session back to the Docebo user + course.
  const response = await client.get('/v1/convai/conversations/get-signed-url', {
    params: {
      agent_id: agentId,
    },
  });

  const signedUrl = response.data?.signed_url;
  if (!signedUrl) {
    throw new Error('ElevenLabs did not return a signed_url');
  }

  // ElevenLabs may return a conversation_id at creation time, or it may be
  // generated when the user connects. Store whichever is available.
  const conversationId = response.data?.conversation_id || null;

  // Append user/course metadata as query params so the completion webhook
  // can identify which learner and course this session belongs to.
  // NOTE: ElevenLabs agents can also be configured to pass custom metadata
  //       through their dashboard — use whichever approach your agent supports.
  const urlWithMeta = appendMetadata(signedUrl, context);

  return {
    signedUrl: urlWithMeta,
    conversationId,
  };
}

/**
 * Appends Docebo user/course context to the signed URL as query parameters.
 * These are forwarded by ElevenLabs back to us in the completion webhook metadata.
 */
function appendMetadata(signedUrl, context) {
  const url = new URL(signedUrl);
  url.searchParams.set('metadata[userId]',   context.userId);
  url.searchParams.set('metadata[courseId]', context.courseId);
  if (context.userName)   url.searchParams.set('metadata[userName]',   context.userName);
  if (context.userEmail)  url.searchParams.set('metadata[userEmail]',  context.userEmail);
  if (context.courseName) url.searchParams.set('metadata[courseName]', context.courseName);
  return url.toString();
}

/**
 * Retrieves full conversation details from ElevenLabs by conversation ID.
 * Useful if the webhook payload is missing details and you need to fetch them.
 *
 * @param {string} conversationId
 */
async function getConversation(conversationId) {
  const client = elevenLabsClient();
  const response = await client.get(`/v1/convai/conversations/${conversationId}`);
  return response.data;
}

module.exports = { createSignedSession, getConversation };
