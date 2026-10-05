import { supabase } from './lib/supabaseClient';

export async function fetchAdminUsers() {
  try {
    const { data: realUsers, error } = await supabase.from('users').select('*');
    if (error) throw error;
    if (Array.isArray(realUsers)) {
      if (typeof window.S === 'object' && window.S) {
        window.S.users = realUsers.map((u, i) => ({
          id: u.id,
          name: u.name || 'User',
          h: u.h || (u.name ? u.name.toLowerCase().replace(/\s+/g, '.') : 'user'),
          email: u.email || '',
          phone: u.phone || '',
          emailVerified: !!u.email_verified,
          phoneVerified: false,
          joined: u.created_at || '2026-10-01',
          createdAt: u.created_at || '',
          lastLoginAt: u.last_sign_in_at || '',
          posts: 0,
          status: u.status || 'active',
          role: u.role || 'USER',
          tick: null,
          pro: 0,
          color: '#ff6b4a'
        }));
        if (typeof window.sv === 'function') window.sv();
        if (typeof window.ut === 'function') window.ut();
      }
    }
  } catch (err) {
    console.warn('Failed to load real users in admin panel:', err);
  }
}

export async function initAdminClient() {
  window.refreshAdminUsers = fetchAdminUsers;
  await fetchAdminUsers();

  // Intercept User Status Changes (Suspend / Restore)
  if (typeof window.us === 'function' && !window.us._hooked) {
    const originalUs = window.us;
    window.us = function (id) {
      const u = typeof window.U === 'function' ? window.U(id) : null;
      const nextStatus = u && u.status === 'suspended' ? 'active' : 'suspended';
      originalUs(id);
      supabase.from('users').update({ status: nextStatus }).eq('id', id).then();
    };
    window.us._hooked = true;
  }

  // Intercept User Deletion
  if (typeof window.ud === 'function' && !window.ud._hooked) {
    const originalUd = window.ud;
    window.ud = function (id) {
      originalUd(id);
      const okBtn = document.getElementById('mok');
      if (okBtn) {
        const origOk = okBtn.onclick;
        okBtn.onclick = function (e) {
          if (origOk) origOk.call(this, e);
          supabase.from('users').delete().eq('id', id).then();
        };
      }
    };
    window.ud._hooked = true;
  }

  setupModerationRoute();
}

function setupModerationRoute() {
  const aside = document.querySelector('aside');
  if (aside && !document.getElementById('nav-modchat')) {
    const btn = document.createElement('button');
    btn.className = 'n';
    btn.id = 'nav-modchat';
    btn.dataset.p = 'modchat';
    btn.textContent = 'Chat Moderation';
    btn.onclick = () => {
      if (typeof window.go === 'function') window.go('modchat');
    };

    const contentLabel = Array.from(aside.querySelectorAll('.gl')).find(
      el => el.textContent.trim() === 'Content'
    );
    if (contentLabel && contentLabel.nextSibling) {
      aside.insertBefore(btn, contentLabel.nextSibling);
    } else {
      aside.appendChild(btn);
    }
  }

  if (typeof window.ROUTES === 'object' && window.ROUTES) {
    window.ROUTES.modchat = renderModerationPage;
  }
}

async function renderModerationPage() {
  const main = document.getElementById('main');
  if (!main) return;

  main.innerHTML = `
    <h2>Chat Moderation</h2>
    <p class="sub">Inspect live conversations, monitor messages, and remove abusive content from Supabase.</p>
    <div class="strip" id="mod-stats">
      <div><b>...</b><span>Total Users</span></div>
      <div><b>...</b><span>Active Conversations</span></div>
      <div><b>...</b><span>Stored Messages</span></div>
    </div>
    <div class="tw" style="margin-top:20px">
      <table>
        <thead>
          <tr>
            <th>Conversation</th>
            <th>Type</th>
            <th>Participants</th>
            <th>Messages</th>
            <th>Latest Preview</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody id="conv-list-body">
          <tr><td colspan="6" class="empty">Loading conversations from Supabase...</td></tr>
        </tbody>
      </table>
    </div>
    <div id="conv-inspect-panel" style="margin-top:24px;display:none" class="pan">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <h3 id="inspect-title" style="margin:0">Messages</h3>
        <button class="btn g sm" onclick="document.getElementById('conv-inspect-panel').style.display='none'">Close</button>
      </div>
      <div id="inspect-messages-list" style="max-height:400px;overflow-y:auto;display:flex;flex-direction:column;gap:8px"></div>
    </div>
  `;

  try {
    const { count: totalUsers } = await supabase.from('users').select('*', { count: 'exact', head: true });
    const { count: totalMessages } = await supabase.from('messages').select('*', { count: 'exact', head: true });

    const statsBox = document.getElementById('mod-stats');
    if (statsBox) {
      statsBox.innerHTML = `
        <div><b>${totalUsers || 0}</b><span>Total Users</span></div>
        <div><b>${totalUsers || 0}</b><span>Active Conversations</span></div>
        <div><b>${totalMessages || 0}</b><span>Stored Messages</span></div>
      `;
    }

    const { data: messages } = await supabase.from('messages').select('*, sender:users!sender_id(name)').order('created_at', { ascending: false }).limit(100);

    const tbody = document.getElementById('conv-list-body');
    if (!tbody) return;

    if (!messages || messages.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty">No conversations found in Supabase yet.</td></tr>';
      return;
    }

    const convs = {};
    for (const m of messages) {
        const pair = [m.sender_id, m.receiver_id].sort().join('_');
        if (!convs[pair]) {
            convs[pair] = { id: pair, participants: 2, messageCount: 0, latest: m, name: (m.sender ? m.sender.name : 'Unknown') + ' Thread' };
        }
        convs[pair].messageCount++;
    }

    tbody.innerHTML = Object.values(convs).map(c => `
      <tr>
        <td><b>${escapeHtml(c.name)}</b></td>
        <td><span class="tag active">Direct</span></td>
        <td>${c.participants}</td>
        <td><b>${c.messageCount}</b></td>
        <td><small style="opacity:.8">${escapeHtml(c.latest.message || 'Media')}</small></td>
        <td>
          <button class="btn g sm" onclick="window.inspectConv('${c.id}', '${escapeHtml(c.name)}')">Inspect</button>
        </td>
      </tr>
    `).join('');

    window.inspectConv = async (convId, convName) => {
      const panel = document.getElementById('conv-inspect-panel');
      const title = document.getElementById('inspect-title');
      const list = document.getElementById('inspect-messages-list');
      if (!panel || !list) return;

      panel.style.display = 'block';
      title.textContent = 'Messages in: ' + convName;
      list.innerHTML = '<p style="opacity:.7">Loading messages...</p>';

      const [u1, u2] = convId.split('_');
      const { data: msgs } = await supabase.from('messages').select('*, sender:users!sender_id(name)').or(`and(sender_id.eq.${u1},receiver_id.eq.${u2}),and(sender_id.eq.${u2},receiver_id.eq.${u1})`).order('created_at', { ascending: false });

      if (!msgs || msgs.length === 0) {
        list.innerHTML = '<p class="empty">No messages in this conversation.</p>';
        return;
      }

      list.innerHTML = msgs.map(m => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:rgba(255,255,255,.05);border-radius:8px">
          <div>
            <b>${escapeHtml(m.sender?.name || 'User')}</b>
            <small style="opacity:.6;margin-left:8px">${m.created_at || ''}</small>
            <div style="margin-top:4px">${escapeHtml(m.message || 'Media')}</div>
          </div>
          <button class="btn d sm" onclick="window.deleteAbusiveMsg('${m.id}', '${convId}', '${convName}')">Delete</button>
        </div>
      `).join('');
    };

    window.deleteAbusiveMsg = async (msgId, convId, convName) => {
      if (!confirm('Are you sure you want to delete this message from Supabase?')) return;
      try {
        await supabase.from('messages').delete().eq('id', msgId);
        if (typeof window.toast === 'function') window.toast('Message deleted');
        window.inspectConv(convId, convName);
      } catch (err) {
        alert('Failed to delete message: ' + err.message);
      }
    };
  } catch (err) {
    console.warn('Moderation page load error:', err);
  }
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));
}
