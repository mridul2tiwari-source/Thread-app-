import { supabase } from './lib/supabaseClient';

let activeChannel = null;
let currentUserId = null;

export async function initChatClient() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;
  currentUserId = session.user.id;

  // Turn OFF fake demo bot replies
  window.CW_DEMO_REPLY = false;

  // 1. Fetch real messages from Supabase
  const { data: msgs, error } = await supabase
    .from('messages')
    .select('*')
    .or(`sender_id.eq.${currentUserId},receiver_id.eq.${currentUserId}`)
    .order('created_at', { ascending: true });

  if (error) console.warn('Failed to load messages from Supabase:', error);

  // Group messages by the "other" user
  const grouped = {};
  if (msgs) {
    for (const m of msgs) {
      const otherId = m.sender_id === currentUserId ? m.receiver_id : m.sender_id;
      if (!grouped[otherId]) {
        grouped[otherId] = {
          id: otherId,
          name: 'User',
          color: '#6c8cff',
          messages: []
        };
      }
      grouped[otherId].messages.push({
        id: m.id,
        sent: m.sender_id === currentUserId,
        text: m.message || '',
        time: m.created_at || 'now',
        _fromServer: true
      });
    }
  }

  // Fetch names for grouped conversations
  const otherUserIds = Object.keys(grouped);
  if (otherUserIds.length > 0) {
    const { data: usersData } = await supabase
      .from('users')
      .select('id, name, avatar_url')
      .in('id', otherUserIds);
      
    if (usersData) {
      for (const u of usersData) {
        if (grouped[u.id]) {
          grouped[u.id].name = u.name;
          if (u.avatar_url) grouped[u.id].previewExt = u.avatar_url; // Simple avatar trick
        }
      }
    }
  }

  const conversations = Object.values(grouped);

  // 2. Synchronize with legacy UI's CHATS array
  const syncToUi = () => {
    const list = window.threadChats ? window.threadChats() : null;
    if (!list) {
      setTimeout(syncToUi, 100);
      return;
    }

    list.length = 0; // Clear mock chats
    conversations.forEach((conv) => {
      wrapMessagesArray(conv);
      list.push(conv);
    });

    try {
      if (window.threadCw && window.threadCw.list) window.threadCw.list();
    } catch (e) {}

    hookOpenChat();
    hookTyping();
  };

  syncToUi();

  // 3. Connect real-time Supabase Channel
  if (activeChannel) supabase.removeChannel(activeChannel);

  activeChannel = supabase.channel('public:messages')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages' },
      (payload) => {
        const msg = payload.new;
        if (msg.sender_id === currentUserId || msg.receiver_id !== currentUserId) return;
        
        const list = window.threadChats ? window.threadChats() : [];
        let chatIdx = list.findIndex(c => c.id === msg.sender_id);
        
        if (chatIdx === -1) {
            const newChat = { id: msg.sender_id, name: 'New Message', color: '#6c8cff', messages: [] };
            wrapMessagesArray(newChat);
            list.push(newChat);
            chatIdx = list.length - 1;
        }

        if (typeof window.cwReceiveMessage === 'function') {
          window.cwReceiveMessage(chatIdx, {
            id: msg.id,
            sent: false,
            text: msg.message || '',
            time: msg.created_at || 'now',
            _fromServer: true
          });
        }
      }
    )
    .subscribe();
}

function wrapMessagesArray(c) {
  if (c.messages._wrapped) return;
  const origPush = c.messages.push;
  c.messages.push = function (...items) {
    const res = origPush.apply(this, items);
    for (const item of items) {
      if (item && item.sent && !item._fromServer && c.id) {
        supabase.from('messages').insert({
          sender_id: currentUserId,
          receiver_id: c.id,
          message: item.text || ''
        }).then(({ error }) => {
            if (error) console.warn('Failed to persist message:', error);
        });
      }
    }
    return res;
  };
  c.messages._wrapped = true;
}

let openChatHooked = false;
function hookOpenChat() {
  if (openChatHooked || typeof window.openChat !== 'function') return;
  const originalOpenChat = window.openChat;
  window.openChat = function (idx) {
    originalOpenChat(idx);
  };
  openChatHooked = true;
}

let typingTimer = null;
function hookTyping() {
  const inp = document.getElementById('cw-input');
  if (!inp || inp._typingHooked) return;
  inp.addEventListener('input', () => {});
  inp._typingHooked = true;
}
