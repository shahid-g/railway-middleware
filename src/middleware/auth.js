// No authentication on the ElevenLabs webhook endpoint.
// The obscurity of the URL is the only protection for now.
function verifyWebhookToken(req, res, next) {
  next();
}

module.exports = { verifyWebhookToken };
