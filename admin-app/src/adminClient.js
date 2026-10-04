import {call} from './api';

let adminToken = null;

export async function fetchAdminUsers() {
  if (!adminToken) return;
  try {
    const realUsers = await call('/admin/users', {token: adminToken});
    if (Array.isArray(realUsers)) {
      if (typeof window.S === 'object' && window.S) {
        window.S.users = realUsers.map((u, i) => ({
          id: u.id,
          name: u.name || 'User',
          h: u.h || (u.name ? u.name.toLowerCase().replace(/\s+/g, '.') : 'user'),
          email: u.email || '',
          phone: u.phone || '',
          emailVerified: !!u.emailVerified,
          phoneVerified: !!u.phoneVerified,
          joined: u.joined || '2026-10-01',
          createdAt: u.createdAt || '',
          lastLoginAt: u.lastLoginAt || '',
          posts: u.posts || 0,
          status: u.status || 'active',
          role: u.role || 'USER',
          tick: u.tick || null,
          pro: u.pro || 0,
          color: u.color || '#ff6b4a'
        }));
        if (typeof window.sv === 'function') window.sv();
        if (typeof window.ut === 'function') window.ut();
      }
    }
  } catch (err) {
    console.warn('Failed to load real users in admin panel:', err);
  }
}

export async function initAdminClient(token) {
  adminToken = token;
  if (!token) return;

  window.refreshAdminUsers = fetchAdminUsers;

  // 1. Fetch real MongoDB users and populate legacy S.users
  await fetchAdminUsers();

  // 2. Intercept User Status Changes (Suspend / Restore)
  if (typeof window.us === 'function' && !window.us._hooked) {
    const originalUs = window.us;
    window.us = function (id) {
      const u = typeof window.U === 'function' ? window.U(id) : null;
      const nextStatus = u && u.status === 'suspended' ? 'active' : 'suspended';
      originalUs(id);
      call('/admin/users/' + id + '/status', {
        method: 'PUT',
        body: {status: nextStatus},
        token: adminToken
      }).catch(e => console.warn('Failed to update status on server:', e));
    };
    window.us._hooked = true;
  }

  // 3. Intercept User Deletion
  if (typeof window.ud === 'function' && !window.ud._hooked) {
    const originalUd = window.ud;
    window.ud = function (id) {
      originalUd(id);
      // When delete is confirmed in modal:
      const okBtn = document.getElementById('mok');
      if (okBtn) {
        const origOk = okBtn.onclick;
        okBtn.onclick = function (e) {
          if (origOk) origOk.call(this, e);
          call('/admin/users/' + id, {
            method: 'DELETE',
            token: adminToken
          }).catch(e => console.warn('Failed to delete user on server:', e));
        };
      }
    };
    window.ud._hooked = true;
  }

  // 4. Intercept Premium toggle
  if (typeof window.pu === 'function' && !window.pu._hooked) {
    const originalPu = window.pu;
    window.pu = function (id) {
      const u = typeof window.U === 'function' ? window.U(id) : null;
      const nextPro = u && u.pro ? 0 : 1;
      originalPu(id);
      call('/admin/users/' + id + '/pro', {
        method: 'PUT',
        body: {pro: nextPro},
        token: adminToken
      }).catch(e => console.warn('Failed to update premium on server:', e));
    };
    window.pu._hooked = true;
  }

  // Remove Chat Moderation option if present
  const modBtn = document.getElementById('nav-modchat');
  if (modBtn) modBtn.remove();
}

function setupModerationRoute() {
  // Inject sidebar link if not present
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

    // Insert under Content group
    const contentLabel = Array.from(aside.querySelectorAll('.gl')).find(
      el => el.textContent.trim() === 'Content'
    );
    if (contentLabel && contentLabel.nextSibling) {
      aside.insertBefore(btn, contentLabel.nextSibling);
    } else {
      aside.appendChild(btn);
    }
  }

  // Register route in window.ROUTES
  if (typeof window.ROUTES === 'object' && window.ROUTES) {
    window.ROUTES.modchat = renderModerationPage;
  }
}

async function renderModerationPage() {
  const main = document.getElementById('main');
  if (!main) return;

  main.innerHTML = `
    <h2>Chat Moderation</h2>
    <p class="sub">Inspect live conversations, monitor messages, and remove abusive content from MongoDB.</p>
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
          <tr><td colspan="6" class="empty">Loading conversations from MongoDB...</td></tr>
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

  // Fetch stats and conversations in parallel
  try {
    const [stats, convs] = await Promise.all([
      call('/admin/stats', {token: adminToken}).catch(() => null),
      call('/admin/conversations', {token: adminToken}).catch(() => [])
    ]);

    if (stats) {
      const statsBox = document.getElementById('mod-stats');
      if (statsBox) {
        statsBox.innerHTML = `
          <div><b>${stats.totalUsers || 0}</b><span>Total Users</span></div>
          <div><b>${stats.totalConversations || 0}</b><span>Active Conversations</span></div>
          <div><b>${stats.totalMessages || 0}</b><span>Stored Messages</span></div>
        `;
      }
    }

    const tbody = document.getElementById('conv-list-body');
    if (!tbody) return;

    if (!convs || convs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty">No conversations found in MongoDB yet.</td></tr>';
      return;
    }

    tbody.innerHTML = convs.map(c => `
      <tr>
        <td><b>${escapeHtml(c.name || 'Chat')}</b></td>
        <td><span class="tag ${c.group ? 'pending' : 'active'}">${c.group ? 'Group' : 'Direct'}</span></td>
        <td>${c.participantCount || 0}</td>
        <td><b>${c.messageCount || 0}</b></td>
        <td><small style="opacity:.8">${escapeHtml(c.preview || 'No messages')}</small></td>
        <td>
          <button class="btn g sm" onclick="window.inspectConv('${c.id}', '${escapeHtml(c.name)}')">Inspect</button>
        </td>
      </tr>
    `).join('');

    // Global helper for opening conversation inspector
    window.inspectConv = async (convId, convName) => {
      const panel = document.getElementById('conv-inspect-panel');
      const title = document.getElementById('inspect-title');
      const list = document.getElementById('inspect-messages-list');
      if (!panel || !list) return;

      panel.style.display = 'block';
      title.textContent = 'Messages in: ' + convName;
      list.innerHTML = '<p style="opacity:.7">Loading messages...</p>';

      try {
        const msgs = await call('/admin/conversations/' + convId + '/messages', {token: adminToken});
        if (!msgs || msgs.length === 0) {
          list.innerHTML = '<p class="empty">No messages in this conversation.</p>';
          return;
        }

        list.innerHTML = msgs.map(m => `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:rgba(255,255,255,.05);border-radius:8px">
            <div>
              <b>${escapeHtml(m.senderName || 'User')}</b>
              <small style="opacity:.6;margin-left:8px">${m.time || ''}</small>
              <div style="margin-top:4px">${escapeHtml(m.text || (m.type ? '[' + m.type.toUpperCase() + ']' : ''))}</div>
            </div>
            <button class="btn d sm" onclick="window.deleteAbusiveMsg('${m.id}', '${convId}', '${convName}')">Delete</button>
          </div>
        `).join('');
      } catch (err) {
        list.innerHTML = '<p style="color:#ff8a7a">Failed to load messages.</p>';
      }
    };

    window.deleteAbusiveMsg = async (msgId, convId, convName) => {
      if (!confirm('Are you sure you want to delete this message from MongoDB?')) return;
      try {
        await call('/admin/messages/' + msgId, {
          method: 'DELETE',
          token: adminToken
        });
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
