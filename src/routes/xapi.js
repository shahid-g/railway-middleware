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

    const signedUrl = session.signedUrl;
    const displayName = userName || 'Learner';
    const displayCourse = courseCode || `Course ${courseId}`;

    // ── Chat page using native browser WebSocket — no CDN dependency ──────
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
      height: min(90vh, 700px);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    }

    /* Header */
    .chat-header {
      padding: 1rem 1.25rem;
      border-bottom: 1px solid #2e3250;
      display: flex;
      align-items: center;
      gap: 0.75rem;
      background: #212436;
      flex-shrink: 0;
    }
    .avatar {
      width: 40px; height: 40px; border-radius: 50%;
      background: linear-gradient(135deg, #3b82f6, #a855f7);
      display: flex; align-items: center; justify-content: center;
      font-size: 1.2rem; flex-shrink: 0;
    }
    .header-text h2 { font-size: 1rem; font-weight: 600; }
    .header-text p  { font-size: 0.75rem; color: #8b8fa8; }
    .conn-badge {
      margin-left: auto;
      font-size: 0.7rem;
      font-weight: 600;
      padding: 3px 10px;
      border-radius: 99px;
      background: rgba(245,158,11,0.15);
      color: #f59e0b;
      border: 1px solid rgba(245,158,11,0.3);
      transition: all 0.3s;
    }
    .conn-badge.connected {
      background: rgba(34,197,94,0.15);
      color: #22c55e;
      border-color: rgba(34,197,94,0.3);
    }
    .conn-badge.error {
      background: rgba(244,63,94,0.15);
      color: #f43f5e;
      border-color: rgba(244,63,94,0.3);
    }

    /* Messages */
    #messages {
      flex: 1;
      overflow-y: auto;
      padding: 1rem;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
    #messages::-webkit-scrollbar { width: 4px; }
    #messages::-webkit-scrollbar-thumb { background: #2e3250; border-radius: 2px; }

    .msg {
      max-width: 82%;
      padding: 0.65rem 1rem;
      border-radius: 12px;
      font-size: 0.9rem;
      line-height: 1.55;
      word-break: break-word;
      animation: fadeIn 0.2s ease;
    }
    @keyframes fadeIn { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:none; } }

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
      max-width: 100%;
      text-align: center;
    }
    .msg .label {
      font-size: 0.68rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 0.3rem;
      color: #8b8fa8;
    }
    .msg.agent .label { color: #a78bfa; }
    .msg.user  .label { color: #60a5fa; }

    /* Typing dots */
    #typing {
      display: none;
      align-self: flex-start;
      padding: 0.65rem 1rem;
      background: #212436;
      border: 1px solid #2e3250;
      border-radius: 12px;
      border-bottom-left-radius: 4px;
      gap: 4px;
      align-items: center;
    }
    #typing.show { display: flex; }
    #typing span {
      width: 7px; height: 7px; border-radius: 50%;
      background: #8b8fa8;
      animation: bounce 1.1s infinite;
    }
    #typing span:nth-child(2) { animation-delay: 0.18s; }
    #typing span:nth-child(3) { animation-delay: 0.36s; }
    @keyframes bounce {
      0%,60%,100% { transform: translateY(0); }
      30%          { transform: translateY(-7px); }
    }

    /* Input */
    .input-area {
      padding: 0.875rem 1rem;
      border-top: 1px solid #2e3250;
      display: flex;
      gap: 0.6rem;
      background: #212436;
      flex-shrink: 0;
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
      min-height: 42px;
      max-height: 120px;
      transition: border-color 0.15s;
    }
    #user-input:focus   { border-color: #3b82f6; }
    #user-input:disabled { opacity: 0.4; cursor: not-allowed; }
    #user-input::placeholder { color: #555a72; }

    #send-btn {
      background: #3b82f6;
      color: #fff;
      border: none;
      border-radius: 8px;
      padding: 0 1.1rem;
      font-size: 0.9rem;
      font-weight: 600;
      cursor: pointer;
      height: 42px;
      align-self: flex-end;
      transition: background 0.15s, opacity 0.15s;
      white-space: nowrap;
    }
    #send-btn:hover:not(:disabled) { background: #2563eb; }
    #send-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  </style>
</head>
<body>
<div class="chat-container">

  <div class="chat-header">
    <div class="avatar">🤖</div>
    <div class="header-text">
      <h2>AI Learning Assistant</h2>
      <p>${displayName} · ${displayCourse}</p>
    </div>
    <div class="conn-badge" id="conn-badge">Connecting…</div>
  </div>

  <div id="messages">
    <div class="msg system">Connecting to your AI assistant…</div>
  </div>
  <div id="typing"><span></span><span></span><span></span></div>

  <div class="input-area">
    <textarea id="user-input" placeholder="Type your message and press Enter…" rows="1" disabled></textarea>
    <button id="send-btn" disabled>Send</button>
  </div>

</div>

<script>
(function () {
  // ── Config injected server-side ──────────────────────────────────────────
  const SIGNED_URL  = ${JSON.stringify(signedUrl)};
  const USER_NAME   = ${JSON.stringify(displayName)};

  // ── DOM refs ─────────────────────────────────────────────────────────────
  const msgsEl  = document.getElementById('messages');
  const inputEl = document.getElementById('user-input');
  const sendBtn = document.getElementById('send-btn');
  const typingEl= document.getElementById('typing');
  const badge   = document.getElementById('conn-badge');

  let ws           = null;
  let pingInterval = null;

  // ── UI helpers ────────────────────────────────────────────────────────────
  function addMsg(role, text) {
    // Remove "Connecting…" system message on first real message
    const sys = msgsEl.querySelector('.msg.system');
    if (sys) sys.remove();

    const div  = document.createElement('div');
    div.className = 'msg ' + role;

    if (role !== 'system') {
      const lbl = document.createElement('div');
      lbl.className = 'label';
      lbl.textContent = role === 'agent' ? 'AI Assistant' : USER_NAME;
      div.appendChild(lbl);
    }

    const body = document.createElement('div');
    body.textContent = text;
    div.appendChild(body);
    msgsEl.appendChild(div);
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  function setBadge(text, cls) {
    badge.textContent = text;
    badge.className   = 'conn-badge ' + (cls || '');
  }

  function setEnabled(on) {
    inputEl.disabled = !on;
    sendBtn.disabled = !on;
    if (on) inputEl.focus();
  }

  // ── Send message ──────────────────────────────────────────────────────────
  function sendMessage() {
    const text = inputEl.value.trim();
    if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;

    addMsg('user', text);
    inputEl.value = '';
    inputEl.style.height = 'auto';
    setEnabled(false);
    typingEl.classList.add('show');

    // ElevenLabs text input message format
    ws.send(JSON.stringify({
      user_activity: {
        type: 'conversation_interaction',
        input_mode: 'text',
        text: text,
      },
    }));
  }

  // ── WebSocket connection ──────────────────────────────────────────────────
  function connect() {
    ws = new WebSocket(SIGNED_URL);

    ws.onopen = () => {
      console.log('[WS] Connected');
      setBadge('Connected', 'connected');

      // Send initiation message required by ElevenLabs Conversational AI
      ws.send(JSON.stringify({
        type: 'conversation_initiation_client_data',
        conversation_config_override: {
          agent: {
            interaction_config: {
              has_user_audio: false,   // chat-only — no mic
              has_agent_audio: false,  // chat-only — no audio output
            },
          },
        },
      }));

      // Keep-alive ping every 20s
      pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping', event_id: Date.now() }));
        }
      }, 20000);

      addMsg('system', 'Connected — type your message below to begin.');
      setEnabled(true);
    };

    ws.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); }
      catch { return; }

      console.log('[WS] Message:', msg);

      const type = msg.type || '';

      if (type === 'conversation_initiation_metadata') {
        // Session is confirmed — nothing to display
        return;
      }

      if (type === 'agent_response') {
        typingEl.classList.remove('show');
        const text = msg.agent_response_event?.agent_response
                  || msg.agent_response
                  || '';
        if (text) {
          addMsg('agent', text);
          setEnabled(true);
        }
        return;
      }

      if (type === 'audio') {
        // Ignore audio frames — chat-only agent
        return;
      }

      if (type === 'ping') {
        // Echo pong back
        ws.send(JSON.stringify({ type: 'pong', event_id: msg.event_id }));
        return;
      }

      if (type === 'interruption' || type === 'user_transcript') {
        return; // Not relevant for chat-only
      }

      if (type === 'error' || type === 'conversation_end') {
        typingEl.classList.remove('show');
        const reason = msg.message || msg.reason || 'Session ended';
        addMsg('system', reason);
        setBadge('Ended', 'error');
        setEnabled(false);
        return;
      }

      // Fallback — log unknown types for debugging
      console.log('[WS] Unhandled type:', type, msg);
    };

    ws.onclose = (evt) => {
      console.log('[WS] Closed:', evt.code, evt.reason);
      clearInterval(pingInterval);
      typingEl.classList.remove('show');
      setBadge('Disconnected', 'error');
      setEnabled(false);
      addMsg('system', 'Session ended. You may close this window.');
    };

    ws.onerror = (err) => {
      console.error('[WS] Error:', err);
      setBadge('Error', 'error');
      addMsg('system', 'Connection error. Please close and try again.');
      setEnabled(false);
    };
  }

  // ── Input events ──────────────────────────────────────────────────────────
  inputEl.addEventListener('input', () => {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
  });

  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  sendBtn.addEventListener('click', sendMessage);

  // ── Start ────────────────────────────────────────────────────────────────
  connect();
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
    body { font-family:sans-serif; background:#0f1117; color:#e8e9f0;
           display:flex; align-items:center; justify-content:center; min-height:100vh; }
    .box { background:#1a1d27; border:1px solid #f43f5e; border-radius:12px;
           padding:2rem; max-width:420px; text-align:center; }
    h2 { color:#f43f5e; margin-bottom:.5rem; }
    p  { color:#8b8fa8; font-size:.9rem; line-height:1.5; }
    code { display:block; margin-top:1rem; font-size:.75rem; color:#555a72;
           background:#0f1117; padding:.5rem; border-radius:6px; }
  </style>
</head>
<body>
  <div class="box">
    <h2>⚠️ Session Error</h2>
    <p>Could not start the AI assistant.<br/>Please close and try again.</p>
    <code>${err.message}</code>
  </div>
</body>
</html>`);
  }
}

router.get('/launch',  launchHandler);
router.post('/launch', launchHandler);

module.exports = router;
