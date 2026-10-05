import { tok } from './api.js';
import { supabase } from './lib/supabaseClient.js';

export async function applyOverrides(tokenProp) {
  const token = tokenProp || tok.get('thread_user_jwt');
  const loadScript = (src) => new Promise(r => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = r;
    document.head.appendChild(s);
  });

  await loadScript('https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js');
  await loadScript('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js');

  const leafletCss = document.createElement('link');
  leafletCss.rel = 'stylesheet';
  leafletCss.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
  document.head.appendChild(leafletCss);

  // 1. Scanner overrides
  const qsVideo = document.getElementById('qs-video');
  const qsFrame = document.getElementById('qs-frame');
  const qsIdle = document.getElementById('qs-idle');
  let scanStream = null;
  let scanInterval = null;

  window.qsStart = async function() {
    try {
      if(scanStream) {
        scanStream.getTracks().forEach(t => t.stop());
      }
      scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      qsVideo.srcObject = scanStream;
      qsVideo.play();
      
      if(qsIdle) qsIdle.style.display = 'none';
      if(qsFrame) qsFrame.style.display = 'block';

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      let scanned = false;
      
      const scan = () => {
        if(scanned || !scanStream) return;
        if(qsVideo.readyState === qsVideo.HAVE_ENOUGH_DATA) {
          canvas.width = qsVideo.videoWidth;
          canvas.height = qsVideo.videoHeight;
          ctx.drawImage(qsVideo, 0, 0, canvas.width, canvas.height);
          const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = window.jsQR(imgData.data, imgData.width, imgData.height);
          
          if(code && code.data) {
            scanned = true;
            handleScannedQR(code.data);
          }
        }
        if(!scanned) {
          scanInterval = requestAnimationFrame(scan);
        }
      };
      scanInterval = requestAnimationFrame(scan);

    } catch (e) {
      console.error('Camera error', e);
      if(qsIdle) {
        qsIdle.style.display = 'flex';
        const t = document.getElementById('qs-idle-t');
        if(t) t.textContent = 'Camera permission denied';
      }
    }
  };

  window.qsTab = function(idx) {
    document.querySelectorAll('.qs-tab').forEach((el, i) => el.classList.toggle('on', i === idx));
    document.getElementById('qr-my-body').style.display = idx === 0 ? 'block' : 'none';
    document.getElementById('qr-scan-body').style.display = idx === 1 ? 'block' : 'none';
    
    if (idx === 1) {
      window.qsStart();
    } else {
      window.camLeave();
    }
  };

  window.camLeave = function() {
    if(scanStream) {
      scanStream.getTracks().forEach(t => t.stop());
      scanStream = null;
    }
    if(scanInterval) cancelAnimationFrame(scanInterval);
  };

  function handleScannedQR(data) {
    window.camLeave();
    // Assuming data is userId or handle
    let username = data;
    if(username.startsWith('http')) {
        const url = new URL(username);
        username = url.pathname.split('/').pop();
    }

    // Call API to find user
    supabase.from('users').select('*').eq('name', username).single().then(({ data: user }) => {
        if (!user) return;
      document.getElementById('qs-ok').classList.add('show');
      document.getElementById('qs-ok-t').textContent = 'Joined successfully!';
      document.getElementById('qs-ok-x').textContent = `You are now connected with ${user.name}`;
      
      const av = document.getElementById('qs-av');
      if(av) {
          if (user.avatar) {
              av.style.backgroundImage = `url(${user.avatar})`;
              av.innerHTML = '';
          } else {
              av.innerHTML = user.name[0].toUpperCase();
          }
      }
    }).catch(err => {
      alert('Invalid user QR code');
      window.qsStart();
    });
  }

  window.qsDone = function() {
    document.getElementById('qs-ok').classList.remove('show');
    window.qsStart();
  };

  // 2. Map
  let leafletMap = null;
  let userMarker = null;

  window.mpToggleLoc = function() {
      const btn = document.getElementById('mp-loc');
      const isOn = btn.classList.contains('on');
      if (isOn) {
          btn.classList.remove('on');
          btn.querySelector('span').textContent = 'Location off';
      } else {
          btn.classList.add('on');
          btn.querySelector('span').textContent = 'Location on';
          window.mpLocate();
      }
  };

  const initMap = () => {
    if(leafletMap) return;
    const canvas = document.getElementById('mp-canvas');
    if(canvas) canvas.style.display = 'none';
    
    const stage = document.getElementById('mp-stage');
    let mapDiv = document.getElementById('real-map');
    if(!mapDiv) {
      mapDiv = document.createElement('div');
      mapDiv.id = 'real-map';
      mapDiv.style.width = '100%';
      mapDiv.style.height = '100%';
      mapDiv.style.position = 'absolute';
      mapDiv.style.top = '0';
      mapDiv.style.left = '0';
      stage.appendChild(mapDiv);
    }
    
    leafletMap = L.map('real-map').setView([20, 0], 2); // globe view
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(leafletMap);
  };

  window.mpLocate = function() {
    if(!leafletMap) initMap();
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((pos) => {
        const { latitude, longitude } = pos.coords;
        leafletMap.flyTo([latitude, longitude], 14, {animate: true, duration: 1});
        if(userMarker) userMarker.remove();
        userMarker = L.marker([latitude, longitude]).addTo(leafletMap);
        userMarker.bindPopup("You are here").openPopup();
      }, () => {
        alert("Location permission denied or unavailable.");
      });
    } else {
      alert("Geolocation is not supported by this browser.");
    }
  };

  window.mpGlobe = function() {
    if(!leafletMap) initMap();
    leafletMap.flyTo([20, 0], 2, {animate: true, duration: 1});
  };

  window.mpZoom = function(dir) {
    if(!leafletMap) initMap();
    if(dir > 0) leafletMap.zoomIn();
    else leafletMap.zoomOut();
  };

  const origGo = window.go;
  window.go = function(id) {
    if (origGo) origGo(id);
    if(id === 'screen-map') {
      setTimeout(initMap, 100);
    }
  };

  // 3. Post Card & Report
  // Wait for post elements to render, then update their names
  const updatePostNames = () => {
    const userDataStr = tok.get('thread_user_data');
    if (!userDataStr) return;
    const user = JSON.parse(userDataStr);
    
    // We update posts that belong to us with our real name instead of Michael Anderson
    document.querySelectorAll('.post-row').forEach(post => {
        const nameEl = post.querySelector('.post-name');
        if (nameEl && nameEl.textContent === 'Michael Anderson') {
            nameEl.textContent = user.name;
        }
    });
  };

  const observer = new MutationObserver(updatePostNames);
  observer.observe(document.body, {childList: true, subtree: true});

  // Override post options menu
  let currentPostTarget = null;
  document.addEventListener('click', e => {
      const dotMenuBtn = e.target.closest('.post-opts-btn'); // Assuming there's a button
      if (dotMenuBtn) {
          currentPostTarget = dotMenuBtn.closest('.post-row');
          const isMyPost = currentPostTarget && currentPostTarget.querySelector('.post-name')?.textContent === JSON.parse(tok.get('thread_user_data')).name;
          
          const sheet = document.getElementById('pc-sheet');
          if (sheet) {
              const delBtn = sheet.querySelector('.pv2-row.danger');
              if (delBtn) {
                  if (isMyPost) {
                      delBtn.innerHTML = '<span class="pv2-ri"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg></span><span class="pv2-rt" id="pc-del-t">Delete post</span>';
                      delBtn.onclick = window.pcDelete; // original
                  } else {
                      delBtn.innerHTML = '<span class="pv2-ri"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></span><span class="pv2-rt" id="pc-del-t">Report post</span>';
                      delBtn.onclick = function() {
                          const reason = prompt("Enter report reason:");
                          if (reason) {
                              alert("Post reported successfully.");
                              window.closeSheet('pc-sheet');
                          }
                      };
                  }
              }
              const editBtn = sheet.querySelectorAll('.pv2-row')[1]; // Edit btn
              if(editBtn) {
                  editBtn.style.display = isMyPost ? 'flex' : 'none';
              }
          }
      }
  });

  // 4. Home Header
  const style = document.createElement('style');
  style.innerHTML = `
    /* Increase home header height */
    #screen-feed .app-header {
      padding-top: 20px !important;
      padding-bottom: 20px !important;
    }
    /* Hide Add Post button in home header */
    #screen-feed .app-header .ap-btn, 
    #screen-feed .app-header [onclick="openAddPost()"],
    #screen-feed .app-header [aria-label="New post"] {
      display: none !important;
    }
    /* Profile header height */
    #screen-profile .pf-top {
      padding-top: 10px !important;
      padding-bottom: 10px !important;
      min-height: auto !important;
    }
    /* Hide large Add Post button */
    #screen-profile .pf-act-btn.ap {
      display: none !important;
    }
    /* Small circular add post button */
    .circular-add-post {
      position: absolute;
      top: 20px;
      right: 20px;
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: var(--coral, #ff6b4a);
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 12px rgba(255, 107, 74, 0.4);
      cursor: pointer;
      z-index: 10;
    }
    .circular-add-post svg {
      width: 24px;
      height: 24px;
    }
    /* Scanner button in settings */
    .st-scanner-btn {
      display: flex;
      align-items: center;
      padding: 12px 16px;
      font-size: 16px;
      cursor: pointer;
      border-bottom: 1px solid rgba(0,0,0,0.05);
    }
    .st-scanner-btn svg { width: 24px; height: 24px; margin-right: 12px; }
  `;
  document.head.appendChild(style);

  // 5. Profile Page Changes
  // Add circular add post button
  const addCircularBtn = () => {
    const pfTop = document.querySelector('#screen-profile .pf-top');
    if (pfTop && !document.getElementById('circ-add-post')) {
      // Find where scanner option was (it was absolute top right probably)
      const existingScanner = pfTop.querySelector('[onclick*="qr-sheet"]');
      if (existingScanner) {
          existingScanner.style.display = 'none'; // hide it here
      }
      const btn = document.createElement('div');
      btn.id = 'circ-add-post';
      btn.className = 'circular-add-post';
      btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>';
      btn.onclick = () => window.openAddPost && window.openAddPost();
      pfTop.appendChild(btn);
    }
  };
  setInterval(addCircularBtn, 1000);

  // Move scanner to settings
  const moveScannerToSettings = () => {
    const settingsBody = document.querySelector('#set-sheet .pv2-body');
    if (settingsBody && !document.getElementById('st-scanner-opt')) {
        const div = document.createElement('div');
        div.id = 'st-scanner-opt';
        div.className = 'pv2-row';
        div.innerHTML = '<span class="pv2-ri"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg></span><span class="pv2-rt">QR Scanner</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>';
        div.onclick = () => {
            window.closeSheet('set-sheet');
            window.openSheet('qr-sheet');
        };
        // insert after account section
        const sec = settingsBody.querySelectorAll('.pv2-sec')[0];
        if (sec) {
            sec.parentNode.insertBefore(div, sec.nextSibling);
        }
    }
  };
  setInterval(moveScannerToSettings, 1000);

  // 7. System Keyboard Toggle
  const addKeyboardToggle = () => {
    const settingsBody = document.querySelector('#set-sheet .pv2-body');
    if (settingsBody && !document.getElementById('st-syskb-opt')) {
        const div = document.createElement('div');
        div.id = 'st-syskb-opt';
        div.className = 'pv2-row';
        const checked = tok.get('thread_syskb') === '1';
        div.innerHTML = `<span class="pv2-ri"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18v12H3z"/><path d="M7 10h.01M12 10h.01M17 10h.01M7 14h10"/></svg></span><span class="pv2-rt">System Keyboard</span><i class="pv2-sw ${checked ? 'on' : ''}" id="st-syskb"></i>`;
        div.onclick = () => {
            const sw = document.getElementById('st-syskb');
            const isOn = sw.classList.contains('on');
            if (isOn) {
                sw.classList.remove('on');
                tok.set('thread_syskb', '0');
                supabase.auth.updateUser({ data: { systemKeyboard: false } });
            } else {
                sw.classList.add('on');
                tok.set('thread_syskb', '1');
                supabase.auth.updateUser({ data: { systemKeyboard: true } });
            }
            applyKeyboardSetting();
        };
        // insert under Preferences
        const prefs = Array.from(settingsBody.querySelectorAll('.pv2-sec')).find(e => e.textContent === 'Preferences');
        if (prefs) {
            prefs.parentNode.insertBefore(div, prefs.nextSibling);
        }
    }
  };
  setInterval(addKeyboardToggle, 1000);

  function applyKeyboardSetting() {
    const sysKb = tok.get('thread_syskb') === '1';
    if(sysKb) {
      document.body.classList.add('force-system-kb');
      // Ensure all inputs don't trigger custom kb
      const style = document.getElementById('syskb-style') || document.createElement('style');
      style.id = 'syskb-style';
      style.innerHTML = `
        #tkb { display: none !important; }
      `;
      document.head.appendChild(style);
    } else {
      document.body.classList.remove('force-system-kb');
      const style = document.getElementById('syskb-style');
      if (style) style.remove();
    }
  }
  
  if (token) {
    supabase.auth.getUser().then(({ data: { user } }) => {
        if(user && user.user_metadata && user.user_metadata.systemKeyboard !== undefined) {
            tok.set('thread_syskb', user.user_metadata.systemKeyboard ? '1' : '0');
            applyKeyboardSetting();
        }
    }).catch(e => {});
  }

  // 6. Admin Badge Realtime Update
  if (token) {
    // We already have STOMP client in chatClient.js but we can just use native WebSocket here or hook into chatClient
    // Let's hook into the global client if possible, or just create a minimal WS
    const wsUrl = (window.location.protocol === 'https:' ? 'wss://' : 'ws://') + window.location.host + '/ws';
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => {
        ws.send(`CONNECT\naccept-version:1.2,1.1,1.0\nAuthorization:Bearer ${token}\n\n\0`);
        setTimeout(() => {
            const userData = JSON.parse(tok.get('thread_user_data') || '{}');
            if (userData.id || userData._id) {
                const id = userData.id || userData._id;
                ws.send(`SUBSCRIBE\nid:sub-badge\ndestination:/user/queue/badge\n\n\0`);
            }
        }, 500);
    };
    ws.onmessage = (e) => {
        const data = e.data;
        if(data && data.indexOf('MESSAGE') === 0 && data.indexOf('/user/queue/badge') !== -1) {
            const bodyStr = data.split('\\n\\n')[1];
            if(bodyStr) {
                try {
                    const payload = JSON.parse(bodyStr.replace(/\\0/g, ''));
                    // update badge UI
                    const verified = payload.verified;
                    const badgeType = payload.badgeType;
                    
                    const userData = JSON.parse(tok.get('thread_user_data') || '{}');
                    userData.verified = verified;
                    userData.badgeType = badgeType;
                    tok.set('thread_user_data', JSON.stringify(userData));
                    
                    // Trigger UI updates
                    const pfName = document.getElementById('pf-name-t');
                    if (pfName) {
                        const existingBadge = pfName.parentNode.querySelector('.v-badge');
                        if (verified) {
                            if (!existingBadge) pfName.insertAdjacentHTML('afterend', '<svg class="v-badge" viewBox="0 0 24 24"><path fill="#1da1f2" d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm-1.8 14.8L6 12.6l1.4-1.4 2.8 2.8 6.4-6.4L18 9l-7.8 7.8z"/></svg>');
                        } else {
                            if (existingBadge) existingBadge.remove();
                        }
                    }
                } catch(err){}
            }
        }
    };
  }
}
