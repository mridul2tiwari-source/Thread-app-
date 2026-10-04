import {call} from './api';

// Native, dependency-free STOMP-over-WebSocket Client
class StompClient {
  constructor(url, token, onConnect, onMessage) {
    this.url = url;
    this.token = token;
    this.onConnect = onConnect;
    this.onMessage = onMessage;
    this.subId = 0;
    this.subs = new Map();
    this.ws = null;
    this.connected = false;
    this.connect();
  }

  connect() {
    try {
      this.ws = new WebSocket(this.url);
      this.ws.onopen = () => {
        const frame = [
          'CONNECT',
          'accept-version:1.2,1.1,1.0',
          'heart-beat:10000,10000',
          'Authorization:Bearer ' + this.token,
          '\n'
        ].join('\n');
        this.ws.send(frame + '\0');
      };

      this.ws.onmessage = (event) => {
        const data = event.data;
        if (!data || data === '\n' || data === '\r\n') return; // heartbeat
        const lines = data.split('\n');
        const command = lines[0].trim();

        if (command === 'CONNECTED') {
          this.connected = true;
          if (this.onConnect) this.onConnect(this);
        } else if (command === 'MESSAGE') {
          let i = 1;
          const headers = {};
          while (i < lines.length && lines[i].trim() !== '') {
            const idx = lines[i].indexOf(':');
            if (idx > -1) {
              headers[lines[i].substring(0, idx).trim()] = lines[i].substring(idx + 1).trim();
            }
            i++;
          }
          const body = lines.slice(i + 1).join('\n').replace(/\0+$/, '').trim();
          let parsed = null;
          try {
            parsed = JSON.parse(body);
          } catch (e) {
            parsed = body;
          }
          if (this.onMessage) this.onMessage(headers.destination, parsed);
        }
      };

      this.ws.onclose = () => {
        this.connected = false;
        setTimeout(() => this.connect(), 4000); // auto-reconnect
      };

      this.ws.onerror = () => {
        try { this.ws.close(); } catch (e) {}
      };
    } catch (e) {
      console.warn('STOMP connection error:', e);
    }
  }

  subscribe(dest) {
    if (!this.connected) return;
    const id = 'sub-' + (++this.subId);
    this.subs.set(dest, id);
    const frame = ['SUBSCRIBE', 'id:' + id, 'destination:' + dest, '\n'].join('\n');
    this.ws.send(frame + '\0');
  }

  send(dest, body) {
    if (!this.connected) return;
    const str = typeof body === 'string' ? body : JSON.stringify(body);
    const frame = [
      'SEND',
      'destination:' + dest,
      'content-type:application/json',
      '\n' + str
    ].join('\n');
    this.ws.send(frame + '\0');
  }

  disconnect() {
    if (this.ws) {
      try {
        this.ws.send('DISCONNECT\n\n\0');
        this.ws.close();
      } catch (e) {}
      this.ws = null;
    }
    this.connected = false;
  }
}

let activeClient = null;
let currentToken = null;
let currentUserId = null;

function parseJwtSubject(token) {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload).sub;
  } catch (e) {
    return null;
  }
}

export async function initChatClient(token) {
  currentToken = token;
  currentUserId = parseJwtSubject(token);
  if (!token) return;

  // Turn OFF fake demo bot replies so real messages are not overwritten with random replies
  window.CW_DEMO_REPLY = false;

  // 1. Fetch real conversations from MongoDB
  let conversations = [];
  try {
    conversations = await call('/conversations', {token});
  } catch (e) {
    console.warn('Failed to load conversations from backend:', e);
  }

  // 2. Synchronize with legacy UI's CHATS array
  const syncToUi = () => {
    const list = window.threadChats ? window.threadChats() : null;
    if (!list) {
      setTimeout(syncToUi, 100);
      return;
    }

    list.length = 0; // Clear mock chats
    conversations.forEach((conv) => {
      const c = {
        id: conv.id,
        name: conv.name,
        color: conv.color || '#6c8cff',
        group: !!conv.group,
        preview: conv.preview || '',
        previewType: conv.previewType,
        previewName: conv.previewName,
        previewExt: conv.previewExt,
        time: conv.time || 'now',
        unread: conv.unread || 0,
        online: !!conv.online,
        messages: (conv.messages || []).map((m) => ({
          id: m.id,
          sent: m.sent !== undefined ? m.sent : (m.senderId === currentUserId),
          text: m.text || '',
          time: m.time || 'now',
          type: m.type || null,
          src: m.src || null,
          name: m.name || null,
          mime: m.mime || null,
          size: m.size || null,
          dur: m.dur || null,
          peaks: m.peaks || null,
          caption: m.caption || null,
          reply: m.reply || null,
          question: m.question || null,
          options: m.options || null,
          votes: m.votes || null,
          total: m.total || null,
          call: m.call || null,
          opened: !!m.opened,
          forwarded: !!m.forwarded,
          edited: !!m.edited,
          _fromServer: true
        }))
      };

      // Wrap messages array so any sent item (text, snap, voice, media, poll) is saved to MongoDB
      wrapMessagesArray(c);
      list.push(c);
    });

    try {
      if (window.threadCw && window.threadCw.list) window.threadCw.list();
    } catch (e) {}

    // Hook openChat to mark conversations as read
    hookOpenChat();
    // Hook typing in cw-input to broadcast typing events
    hookTyping();
  };

  syncToUi();

  // 3. Connect real-time WebSocket / STOMP
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsHost = window.location.host;
  const wsUrl = `${wsProtocol}//${wsHost}/ws`;

  if (activeClient) activeClient.disconnect();

  activeClient = new StompClient(
    wsUrl,
    token,
    (client) => {
      // Subscribe to user conversation events
      if (currentUserId) {
        client.subscribe('/topic/user.' + currentUserId + '.conversations');
      }

      // Subscribe to each conversation room and typing channel
      conversations.forEach((conv) => {
        client.subscribe('/topic/conversation.' + conv.id);
        client.subscribe('/topic/conversation.' + conv.id + '.typing');
      });
    },
    (destination, message) => {
      handleIncomingWsMessage(destination, message);
    }
  );
}

function wrapMessagesArray(c) {
  if (c.messages._wrapped) return;
  const origPush = c.messages.push;
  c.messages.push = function (...items) {
    const res = origPush.apply(this, items);
    for (const item of items) {
      if (item && item.sent && !item._fromServer && c.id) {
        // Persist to MongoDB via REST API
        call('/conversations/' + c.id + '/messages', {
          method: 'POST',
          body: {
            conversationId: c.id,
            text: item.text || '',
            type: item.type || null,
            src: item.src || null,
            name: item.name || null,
            mime: item.mime || null,
            size: item.size || null,
            dur: item.dur || null,
            peaks: item.peaks || null,
            caption: item.caption || null,
            reply: item.reply || null,
            question: item.question || null,
            options: item.options || null,
            votes: item.votes || null,
            total: item.total || null,
            call: item.call || null
          },
          token: currentToken
        }).catch((err) => console.warn('Failed to persist message:', err));
      }
    }
    return res;
  };
  c.messages._wrapped = true;
}

function handleIncomingWsMessage(destination, message) {
  if (!message) return;

  // Handle typing indicator: /topic/conversation.{id}.typing
  if (destination && destination.endsWith('.typing')) {
    if (message.userId && message.userId === currentUserId) return; // ignore self
    const list = window.threadChats ? window.threadChats() : [];
    const chatIdx = list.findIndex((c) => c.id === message.conversationId);
    if (chatIdx > -1 && typeof window.cwSetTyping === 'function') {
      window.cwSetTyping(chatIdx, !!message.typing);
    }
    return;
  }

  // Handle conversation update: /topic/user.{id}.conversations
  if (destination && destination.includes('.conversations')) {
    return;
  }

  // Handle incoming message: /topic/conversation.{id}
  if (message.senderId && message.senderId === currentUserId) {
    // Already rendered locally
    return;
  }

  const list = window.threadChats ? window.threadChats() : [];
  const chatIdx = list.findIndex((c) => c.id === message.conversationId);
  if (chatIdx > -1 && typeof window.cwReceiveMessage === 'function') {
    const incomingMsg = {
      id: message.id,
      sent: false,
      text: message.text || '',
      time: message.time || 'now',
      type: message.type || null,
      src: message.src || null,
      name: message.name || null,
      mime: message.mime || null,
      size: message.size || null,
      dur: message.dur || null,
      peaks: message.peaks || null,
      caption: message.caption || null,
      reply: message.reply || null,
      question: message.question || null,
      options: message.options || null,
      votes: message.votes || null,
      total: message.total || null,
      call: message.call || null,
      _fromServer: true
    };
    window.cwReceiveMessage(chatIdx, incomingMsg);
  }
}

let openChatHooked = false;
function hookOpenChat() {
  if (openChatHooked || typeof window.openChat !== 'function') return;
  const originalOpenChat = window.openChat;
  window.openChat = function (idx) {
    originalOpenChat(idx);
    const chats = window.threadChats ? window.threadChats() : [];
    const c = chats[idx];
    if (c && c.id && currentToken) {
      call('/conversations/' + c.id + '/read', {
        method: 'POST',
        token: currentToken
      }).catch(() => {});
    }
  };
  openChatHooked = true;
}

let typingTimer = null;
function hookTyping() {
  const inp = document.getElementById('cw-input');
  if (!inp || inp._typingHooked) return;
  inp.addEventListener('input', () => {
    const cur = window.threadActiveChat ? window.threadActiveChat() : null;
    if (!cur || !cur.id || !activeClient) return;

    activeClient.send('/app/chat.typing', {
      conversationId: cur.id,
      typing: true
    });

    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
      activeClient.send('/app/chat.typing', {
        conversationId: cur.id,
        typing: false
      });
    }, 2000);
  });
  inp._typingHooked = true;
}
