const express           = require('express');
const router            = express.Router();
const elevenLabsService = require('../services/elevenlabs');

async function launchHandler(req, res) {
  try {
    const params = Object.assign({}, req.query, req.body);
    console.log(`[LAUNCH] ${req.method} ${req.originalUrl}`);
    console.log('[LAUNCH] Params:', JSON.stringify(params, null, 2));

    const userId     = params.user_id     || params.userId     || '';
    const courseId   = params.course_id   || params.courseId   || '';
    const username   = params.username    || '';
    const courseCode = params.course_code || params.courseCode || '';

    let userEmail = '';
    let userName  = username;

    if (params.actor) {
      try {
        const actor = typeof params.actor === 'string'
          ? JSON.parse(params.actor)
          : params.actor;
        const mboxRaw = Array.isArray(actor.mbox) ? actor.mbox[0] : (actor.mbox || '');
        userEmail = mboxRaw.replace('mailto:', '').trim();
        userName  = Array.isArray(actor.name) ? actor.name[0] : (actor.name || username);
      } catch (e) {
        console.warn('[LAUNCH] Could not parse actor:', e.message);
      }
    }

    console.log(`[LAUNCH] user=${userId} course=${courseId} email=${userEmail} name=${userName}`);

    if (!userId || !courseId) {
      return res.status(400).json({
        error:         'Missing required parameters: user_id and course_id',
        received_keys: Object.keys(params),
      });
    }

    // Get the signed WebSocket URL from ElevenLabs
    const session = await elevenLabsService.createSignedSession({
      userId, courseId, userName, userEmail,
      courseName: courseCode || `Course ${courseId}`,
    });

    console.log(`[LAUNCH] ✓ Signed URL obtained — conv=${session.conversationId}`);

    // Return an HTML page that embeds the ElevenLabs widget.
    // The widget handles the WebSocket (wss://) connection internally —
    // the browser never sees the raw WebSocket URL.
    const agentId   = process.env.ELEVENLABS_AGENT_ID;
    const signedUrl = session.signedUrl;

    return res.status(200).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>AI Conversation</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0f1117;
      color: #e8e9f0;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 2rem;
    }

    .card {
      background: #1a1d27;
      border: 1px solid #2e3250;
      border-radius: 16px;
      padding: 2.5rem 2rem;
      max-width: 480px;
      width: 100%;
      text-align: center;
    }

    .avatar {
      width: 72px; height: 72px;
      border-radius: 50%;
      background: linear-gradient(135deg, #3b82f6, #a855f7);
      display: flex; align-items: center; justify-content: center;
      font-size: 2rem;
      margin: 0 auto 1.2rem;
    }

    h1 { font-size: 1.4rem; font-weight: 600; margin-bottom: 0.4rem; }

    .subtitle {
      font-size: 0.9rem;
      color: #8b8fa8;
      margin-bottom: 1.8rem;
      line-height: 1.5;
    }

    /* ElevenLabs widget container */
    #widget-container {
      display: flex;
      justify-content: center;
      margin-bottom: 1.5rem;
    }

    .status {
      font-size: 0.8rem;
      color: #8b8fa8;
      margin-top: 1rem;
    }

    .status span {
      display: inline-block;
      width: 8px; height: 8px;
      border-radius: 50%;
      background: #22c55e;
      margin-right: 5px;
      vertical-align: middle;
      animation: pulse 1.5s infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }

    .user-info {
      font-size: 0.78rem;
      color: #555a72;
      margin-top: 0.6rem;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="avatar">🎙️</div>
    <h1>AI Learning Assistant</h1>
    <p class="subtitle">
      Your AI tutor is ready. Click the button below to start your<br/>
      voice conversation.
    </p>

    <div id="widget-container">
      <!--
        ElevenLabs Conversational AI widget.
        We pass the signed-url so no API key is exposed in the browser.
        The widget handles the WebSocket connection internally.
      -->
      <elevenlabs-convai
        agent-id="${agentId}"
        signed-url="${signedUrl}"
      ></elevenlabs-convai>
    </div>

    <div class="status"><span></span>Connected to AI assistant</div>
    <div class="user-info">${userName ? `Logged in as ${userName}` : ''} ${courseCode ? `· ${courseCode}` : ''}</div>
  </div>

  <!-- ElevenLabs Conversational AI Widget -->
  <script
    src="https://elevenlabs.io/convai-widget/index.js"
    async
    type="text/javascript">
  </script>
</body>
</html>`);

  } catch (err) {
    console.error('[LAUNCH] Error:', err.message, err.stack);
    return res.status(500).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>Error</title>
  <style>
    body { font-family: sans-serif; background: #0f1117; color: #e8e9f0;
           display:flex; align-items:center; justify-content:center; min-height:100vh; }
    .box { background:#1a1d27; border:1px solid #f43f5e; border-radius:12px;
           padding:2rem; max-width:400px; text-align:center; }
    h2 { color:#f43f5e; margin-bottom:0.5rem; }
    p  { color:#8b8fa8; font-size:0.9rem; }
  </style>
</head>
<body>
  <div class="box">
    <h2>⚠️ Session Error</h2>
    <p>Could not start the AI session. Please close this window and try again.</p>
    <p style="margin-top:1rem;font-size:0.75rem;color:#555">${err.message}</p>
  </div>
</body>
</html>`);
  }
}

router.get('/launch',  launchHandler);
router.post('/launch', launchHandler);

module.exports = router;
