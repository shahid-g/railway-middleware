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

    const session = await elevenLabsService.createSignedSession({
      userId, courseId, userName, userEmail,
      courseName: courseCode || `Course ${courseId}`,
    });

    console.log(`[LAUNCH] ✓ Session ready — conv=${session.conversationId}`);

    const agentId   = process.env.ELEVENLABS_AGENT_ID;
    const signedUrl = session.signedUrl;

    // ── Return a chat-only HTML page using the ElevenLabs JS SDK ──────────
    // The convai widget defaults to voice mode. For a chat-only agent we
    // use the @11labs/client SDK directly via CDN and disable audio entirely.
    return res.status(200).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>AI Learning Assistant</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0f1117;
      color: #e8e9f0;
      height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 1rem;
    }

    .chat-container {
      background: #1a1d27;
      border: 1px solid #2e3250;
      border-radius: 16px;
      width: 100%;
      max-width: 640px;
      height: 90vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .chat-header {
      padding: 1rem 1.25rem;
      border-bottom: 1px solid #2e3250;
      display: flex;
      align-items: center;
      gap: 0.75rem;
      background: #212436;
    }

    .avatar {
      width: 40px; height: 40px;
      border-radius: 50%;
      background: linear-gradient(135deg, #3b82f6, #a855f7);
      display: flex; align-items: center; justify-content: center;
      font-size: 1.2rem;
      flex-shrink: 0;
    }

    .header-text h2 { font-size: 1rem; font-weight: 600; }
    .header-text p  { font-size: 0.75rem; color: #8b8fa8; }

    .status-dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: #22c55e;
      margin-left: auto;
      flex-shrink: 0;
    }
    .status-dot.connecting { background: #f59e0b; animation: pulse 1s infinite; }
    .status-dot.error      { background: #f43f5e; animation: none; }

    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }

    /* Messages area */
    #messages {
      flex: 1;
      overflow-y: auto;
      padding: 1rem;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      scroll-behavior: smooth;
    }

    #messages::-webkit-scrollbar { width: 4px; }
    #messages::-webkit-scrollbar-track { background: transparent; }
    #messages::-webkit-scrollbar-thumb { background: #2e3250; border-radius: 2px; }

    .msg {
      max-width: 80%;
      padding: 0.65rem 1rem;
      border-radius: 12px;
      font-size: 0.9rem;
      line-height: 1.5;
      word-break: break-word;
    }

    .msg.agent {
      background: #212436;
      border: 1px solid #2e3250;
      align-self: flex-start;
      border-bottom-left-radius: 4px;
    }

    .msg.user {
      background: #1e3a5f;
      border: 1px solid #2a4a7a;
      align-self: flex-end;
      border-bottom-right-radius: 4px;
      color: #bfdbfe;
    }

    .msg.system {
      align-self: center;
      background: transparent;
      border: none;
      font-size: 0.75rem;
      color: #555a72;
      font-style: italic;
    }

    .msg .sender {
      font-size: 0.7rem;
      font-weight: 600;
      color: #8b8fa8;
      margin-bottom: 0.3rem;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .msg.agent .sender { color: #a855f7; }
    .msg.user  .sender { color: #3b82f6; }

    /* Typing indicator */
    .typing {
      display: none;
      align-self: flex-start;
      padding: 0.65rem 1rem;
      background: #212436;
      border: 1px solid #2e3250;
      border-radius: 12px;
      border-bottom-left-radius: 4px;
    }
    .typing.visible { display: flex; gap: 4px; align-items: center; }
    .typing span {
      width: 7px; height: 7px; border-radius: 50%;
      background: #8b8fa8;
      animation: bounce 1.2s infinite;
    }
    .typing span:nth-child(2) { animation-delay: 0.2s; }
    .typing span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes bounce { 0%,60%,100%{transform:translateY(0)} 30%{transform:translateY(-6px)} }

    /* Input area */
    .input-area {
      padding: 0.875rem 1rem;
      border-top: 1px solid #2e3250;
      display: flex;
      gap: 0.5rem;
      background: #212436;
    }

    #user-input {
      flex: 1;
      background: #0f1117;
      border: 1px solid #2e3250;
      border-radius: 8px;
      color: #e8e9f0;
      padding: 0.6rem 0.9rem;
      font-size: 0.9rem;
      font-family: inherit;
      resize: none;
      outline: none;
      transition: border-color 0.15s;
      min-height: 42px;
      max-height: 120px;
    }

    #user-input:focus { border-color: #3b82f6; }
    #user-input::placeholder { color: #555a72; }
    #user-input:disabled { opacity: 0.4; cursor: not-allowed; }

    #send-btn {
      background: #3b82f6;
      color: #fff;
      border: none;
      border-radius: 8px;
      padding: 0 1.1rem;
      font-size: 0.9rem;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s, opacity 0.15s;
      white-space: nowrap;
      align-self: flex-end;
      height: 42px;
    }

    #send-btn:hover:not(:disabled) { background: #2563eb; }
    #send-btn:disabled { opacity: 0.4; cursor: not-allowed; }

    #status-bar {
      text-align: center;
      font-size: 0.75rem;
      color: #555a72;
      padding: 0.4rem;
      border-top: 1px solid #2e3250;
    }
  </style>
</head>
<body>

<div class="chat-container">
  <div class="chat-header">
    <div class="avatar">🤖</div>
    <div class="header-text">
      <h2>AI Learning Assistant</h2>
      <p>${userName ? 'Welcome, ' + userName : 'Type your message to begin'}</p>
    </div>
    <div class="status-dot connecting" id="status-dot"></div>
  </div>

  <div id="messages">
    <div class="msg system">Connecting to your AI assistant…</div>
  </div>

  <div class="typing" id="typing">
    <span></span><span></span><span></span>
  </div>

  <div class="input-area">
    <textarea
      id="user-input"
      placeholder="Type your message and press Enter or Send…"
      rows="1"
      disabled
    ></textarea>
    <button id="send-btn" disabled>Send</button>
  </div>

  <div id="status-bar">Initialising…</div>
</div>

<!--
  ElevenLabs JS client SDK (UMD build from CDN).
  Used instead of the convai widget so we can drive chat-only mode
  and handle text input/output ourselves.
-->
<script src="https://cdn.jsdelivr.net/npm/@11labs/client@latest/dist/index.umd.js"></script>

<script>
(async () => {
  const signedUrl   = ${JSON.stringify(signedUrl)};
  const agentId     = ${JSON.stringify(agentId)};
  const userName    = ${JSON.stringify(userName || 'Learner')};

  const messagesEl  = document.getElementById('messages');
  const inputEl     = document.getElementById('user-input');
  const sendBtn     = document.getElementById('send-btn');
  const typingEl    = document.getElementById('typing');
  const statusBar   = document.getElementById('status-bar');
  const statusDot   = document.getElementById('status-dot');

  let conversation  = null;

  // ── UI helpers ────────────────────────────────────────────────────────────
  function addMessage(role, text) {
    const lastSystem = messagesEl.querySelector('.msg.system:last-child');
    if (lastSystem) lastSystem.remove();

    const div = document.createElement('div');
    div.className = 'msg ' + role;

    if (role !== 'system') {
      const sender = document.createElement('div');
      sender.className = 'sender';
      sender.textContent = role === 'agent' ? 'AI Assistant' : userName;
      div.appendChild(sender);
    }

    const text_node = document.createElement('div');
    text_node.textContent = text;
    div.appendChild(text_node);
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function setStatus(text, dotClass) {
    statusBar.textContent = text;
    statusDot.className = 'status-dot ' + (dotClass || '');
  }

  function setInputEnabled(enabled) {
    inputEl.disabled  = !enabled;
    sendBtn.disabled  = !enabled;
    if (enabled) inputEl.focus();
  }

  // ── Send message ──────────────────────────────────────────────────────────
  async function sendMessage() {
    const text = inputEl.value.trim();
    if (!text || !conversation) return;

    inputEl.value = '';
    inputEl.style.height = 'auto';
    addMessage('user', text);
    setInputEnabled(false);
    typingEl.classList.add('visible');

    try {
      // ElevenLabs client sendMessage for text/chat agents
      await conversation.sendMessage(text);
    } catch (err) {
      typingEl.classList.remove('visible');
      addMessage('system', 'Error sending message: ' + err.message);
      setInputEnabled(true);
    }
  }

  // ── Auto-resize textarea ──────────────────────────────────────────────────
  inputEl.addEventListener('input', () => {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
  });

  // Enter to send (Shift+Enter for new line)
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  sendBtn.addEventListener('click', sendMessage);

  // ── Connect to ElevenLabs ─────────────────────────────────────────────────
  try {
    setStatus('Connecting…');

    const ElevenLabsClient = window.ElevenLabsClient || window['@11labs/client'];
    const Conversation = ElevenLabsClient?.Conversation;

    if (!Conversation) {
      throw new Error('ElevenLabs SDK not loaded. Check network connection.');
    }

    conversation = await Conversation.startSession({
      signedUrl,

      // Disable audio completely — text/chat agent only
      disableAudio: true,

      onConnect: () => {
        console.log('[ElevenLabs] Connected');
        setStatus('Connected — type your message below', '');
        statusDot.className = 'status-dot';
        setInputEnabled(true);
        addMessage('system', 'Connected. Type your message to begin.');
      },

      onDisconnect: () => {
        console.log('[ElevenLabs] Disconnected');
        setStatus('Session ended', 'error');
        setInputEnabled(false);
        addMessage('system', 'The session has ended. You may close this window.');
      },

      onError: (err) => {
        console.error('[ElevenLabs] Error:', err);
        setStatus('Connection error', 'error');
        statusDot.className = 'status-dot error';
        addMessage('system', 'Connection error: ' + (err?.message || String(err)));
        setInputEnabled(false);
      },

      // Handles text messages from the agent
      onMessage: (msg) => {
        console.log('[ElevenLabs] Message:', msg);
        typingEl.classList.remove('visible');

        const text = msg?.message || msg?.text || msg?.content || JSON.stringify(msg);
        const role = msg?.source === 'user' ? 'user' : 'agent';

        // Only display agent messages here — user messages already added on send
        if (role === 'agent') {
          addMessage('agent', text);
          setInputEnabled(true);
        }
      },

      // Suppress any audio mode requests
      onModeChange: (mode) => {
        console.log('[ElevenLabs] Mode change:', mode);
      },
    });

  } catch (err) {
    console.error('[INIT] Failed to connect:', err);
    setStatus('Failed to connect', 'error');
    statusDot.className = 'status-dot error';
    addMessage('system', 'Could not connect to AI assistant: ' + err.message);
  }
})();
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
    body { font-family: sans-serif; background:#0f1117; color:#e8e9f0;
           display:flex; align-items:center; justify-content:center; min-height:100vh; }
    .box { background:#1a1d27; border:1px solid #f43f5e; border-radius:12px;
           padding:2rem; max-width:420px; text-align:center; }
    h2 { color:#f43f5e; margin-bottom:.5rem; }
    p  { color:#8b8fa8; font-size:.9rem; line-height:1.5; }
    code { display:block; margin-top:1rem; font-size:.75rem; color:#555; }
  </style>
</head>
<body>
  <div class="box">
    <h2>⚠️ Session Error</h2>
    <p>Could not start the AI assistant session.<br/>Please close this window and try again.</p>
    <code>${err.message}</code>
  </div>
</body>
</html>`);
  }
}

router.get('/launch',  launchHandler);
router.post('/launch', launchHandler);

module.exports = router;
