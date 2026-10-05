import {useEffect, useRef} from 'react';
import { useGoogleLogin } from '@react-oauth/google';
import body from './legacy/body.html?raw';
import scripts from './legacy/scripts.json';
import ext from './legacy/ext.json';
import './legacy/legacy.css';
import {initChatClient} from './chatClient';
import {tok, call} from './api';
import { applyOverrides } from './overrides';

function run(code){const s=document.createElement('script');s.text=code;document.body.appendChild(s);s.remove()}
function load(src){return new Promise(r=>{const s=document.createElement('script');s.src=src;s.onload=s.onerror=r;document.head.appendChild(s)})}

let host = null;
let booted = false;

// ── State for Auth Flows ───────────────────────────────────────────────────
let _pendingReg = { name: '', email: '', password: '', confirmPassword: '' };
let _loginEmail = '';
let _resetEmail = '';
let _resetOtp = '';
let _otpCountdownTimer = null;

function setErrMsg(screenId, msgId, text, isSuccess = false) {
  const scr = document.getElementById(screenId);
  if (!scr) return;
  let el = scr.querySelector('#' + msgId);
  if (!el) {
    el = document.createElement('p');
    el.id = msgId;
    el.className = isSuccess ? 'hint' : 'err';
    el.style.textAlign = 'center';
    el.style.marginTop = '10px';
    el.style.fontSize = '14px';
    const form = scr.querySelector('form');
    if (form) form.appendChild(el);
    else scr.appendChild(el);
  }
  el.textContent = text;
  el.style.display = text ? 'block' : 'none';
  el.style.color = isSuccess ? '#4caf50' : '#ff4d4f';
}

function updateProfileUI(user) {
  if (!user) return;
  try {
    const pfUser = document.getElementById('pf-user');
    if (pfUser) pfUser.textContent = '@' + (user.handle || user.name || 'user');
    const pfName = document.getElementById('pf-name-t');
    if (pfName) pfName.textContent = user.name || 'User';
  } catch (e) {
    console.error('Error updating profile UI:', e);
  }
}

// ── Password Evaluation Helpers ───────────────────────────────────────────
function evaluatePassword(pwd) {
  return {
    len: (pwd || '').length >= 8,
    upper: /[A-Z]/.test(pwd || ''),
    lower: /[a-z]/.test(pwd || ''),
    num: /[0-9]/.test(pwd || ''),
    spec: /[^A-Za-z0-9]/.test(pwd || ''),
  };
}

function updateRuleUI(elId, passed) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (passed) {
    el.classList.add('ok');
    const ic = el.querySelector('.rule-icon');
    if (ic) ic.textContent = '✓';
  } else {
    el.classList.remove('ok');
    const ic = el.querySelector('.rule-icon');
    if (ic) ic.textContent = '✕';
  }
}

// ── Password Eye Toggle Helper ─────────────────────────────────────────────
window.pwEye = function(inputId, btn) {
  const inp = document.getElementById(inputId);
  if (!inp) return;
  if (inp.type === 'password') {
    inp.type = 'text';
    btn.style.color = 'var(--coral, #ff6b4a)';
  } else {
    inp.type = 'password';
    btn.style.color = '';
  }
};

// ── Live Register Password Validator ───────────────────────────────────────
window.checkRegPassword = function() {
  const p = document.getElementById('reg-pass')?.value || '';
  const cp = document.getElementById('reg-confirm-pass')?.value || '';
  const r = evaluatePassword(p);

  updateRuleUI('reg-rule-len', r.len);
  updateRuleUI('reg-rule-upper', r.upper);
  updateRuleUI('reg-rule-lower', r.lower);
  updateRuleUI('reg-rule-num', r.num);
  updateRuleUI('reg-rule-spec', r.spec);

  const matchEl = document.getElementById('reg-rule-match');
  if (matchEl) {
    if (cp.length > 0) {
      matchEl.style.display = 'flex';
      updateRuleUI('reg-rule-match', p.length > 0 && p === cp);
    } else {
      matchEl.style.display = 'none';
    }
  }
};

// ── Live Reset Password Validator ──────────────────────────────────────────
window.pwCheck = function() {
  const p = document.getElementById('new-pass')?.value || '';
  const cp = document.getElementById('confirm-pass')?.value || '';
  const r = evaluatePassword(p);

  updateRuleUI('reset-rule-len', r.len);
  updateRuleUI('reset-rule-upper', r.upper);
  updateRuleUI('reset-rule-lower', r.lower);
  updateRuleUI('reset-rule-num', r.num);
  updateRuleUI('reset-rule-spec', r.spec);

  const matchEl = document.getElementById('reset-rule-match');
  if (matchEl) {
    if (cp.length > 0) {
      matchEl.style.display = 'flex';
      updateRuleUI('reset-rule-match', p.length > 0 && p === cp);
    } else {
      matchEl.style.display = 'none';
    }
  }
};

// ── OTP Resend Countdown Timer ─────────────────────────────────────────────
function startOtpCountdown(seconds = 60) {
  clearInterval(_otpCountdownTimer);
  let remaining = seconds;
  const timerText = document.getElementById('otp-timer-text');
  const countdownEl = document.getElementById('otp-countdown');
  const resendBtn = document.getElementById('otp-resend-btn');

  if (timerText) timerText.style.display = 'inline';
  if (resendBtn) resendBtn.style.display = 'none';
  if (countdownEl) countdownEl.textContent = `${remaining}s`;

  _otpCountdownTimer = setInterval(() => {
    remaining--;
    if (countdownEl) countdownEl.textContent = `${remaining}s`;
    if (remaining <= 0) {
      clearInterval(_otpCountdownTimer);
      if (timerText) timerText.style.display = 'none';
      if (resendBtn) resendBtn.style.display = 'inline-block';
    }
  }, 1000);
}

// ── OTP Input and Navigation Helpers ───────────────────────────────────────
window.onOtpInput = function(el, idx) {
  el.value = el.value.replace(/[^0-9]/g, '').slice(0, 1);
  const otpInputs = Array.from(document.querySelectorAll('.otp-box'));
  if (el.value && idx < otpInputs.length - 1) {
    otpInputs[idx + 1].focus();
  }
  const val = otpInputs.map(i => i.value).join('');
  if (val.length === 6) {
    window.checkOtp(val);
  }
};

window.onOtpKeydown = function(e, idx) {
  const otpInputs = Array.from(document.querySelectorAll('.otp-box'));
  if (e.key === 'Backspace' && !e.target.value && idx > 0) {
    otpInputs[idx - 1].focus();
  }
};

window.backFromOtp = function() {
  clearInterval(_otpCountdownTimer);
  const goFn = window.go || (typeof go !== 'undefined' ? go : null);
  if (!goFn) return;
  if (window.otpContext === 'login') {
    goFn('screen-login');
  } else if (window.otpContext === 'reset') {
    goFn('screen-forgot-email');
  } else {
    goFn('screen-register');
  }
};

window.submitOtpVerification = function() {
  const otpInputs = Array.from(document.querySelectorAll('.otp-box'));
  const val = otpInputs.map(i => i.value).join('');
  if (val.length < 6) {
    const errEl = document.getElementById('otp-err-msg');
    if (errEl) {
      errEl.textContent = 'Please enter all 6 digits of the verification code.';
      errEl.style.display = 'block';
      errEl.style.color = '#ff4d4f';
    }
    return;
  }
  window.checkOtp(val);
};

export default function LegacyApp({token, onTokenChange}){
  const containerRef = useRef(null);

  const triggerGoogleLogin = useGoogleLogin({
    onSuccess: async (tokenResponse) => {
      try {
        const userInfo = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: `Bearer ${tokenResponse.access_token}` },
        }).then(res => res.json());

        if (!userInfo || !userInfo.email) {
          throw new Error('Could not retrieve your Google account info.');
        }

        if (window.handleGoogleAuth) {
          window.handleGoogleAuth({
            name: userInfo.name || userInfo.email.split('@')[0],
            email: userInfo.email,
            avatar: userInfo.picture || '',
            accessToken: tokenResponse.access_token
          });
        }
      } catch (e) {
        console.error('Failed to fetch google user info', e);
        // Restore button state
        document.querySelectorAll('.btn-google').forEach(b => {
          b.disabled = false;
          b.style.opacity = '';
          b.style.pointerEvents = '';
        });
        const errMsg = e.message || 'Google sign-in failed. Please try again.';
        // Show error near the active auth screen
        const activeErr = document.querySelector('.screen.active .err[id*="err"]');
        if (activeErr) {
          activeErr.textContent = errMsg;
          activeErr.style.display = 'block';
          activeErr.style.color = '#ff4d4f';
        }
      }
    },
    onError: (err) => {
      console.warn('Google OAuth error or cancelled:', err);
      // Restore button state — user may have just closed the popup
      document.querySelectorAll('.btn-google').forEach(b => {
        b.disabled = false;
        b.style.opacity = '';
        b.style.pointerEvents = '';
      });
    },
    onNonOAuthError: (err) => {
      console.warn('Google non-OAuth error:', err);
      document.querySelectorAll('.btn-google').forEach(b => {
        b.disabled = false;
        b.style.opacity = '';
        b.style.pointerEvents = '';
      });
    }
  });

  useEffect(()=>{
    if (!host) {
      host = document.createElement('div');
      host.id = 'legacy-root';
      host.innerHTML = body;
    }

    if (containerRef.current && !containerRef.current.contains(host)) {
      containerRef.current.appendChild(host);
    }

    const bootApp = async () => {
      if (!booted) {
        booted = true;
        for (const u of ext) await load(u);
        for (const c of scripts) {
          try { run(c); } catch (e) { console.error(e); }
        }
        applyOverrides(token);
        document.dispatchEvent(new Event('DOMContentLoaded'));
        window.dispatchEvent(new Event('load'));
      }

      // Check existing saved user data and update profile
      try {
        const savedUserStr = tok.get('thread_user_data');
        if (savedUserStr) {
          updateProfileUI(JSON.parse(savedUserStr));
        }
      } catch (e) {}

      // ─── AUTO-REDIRECT & AUTH GUARD ────────────────────────────────────────
      const activeToken = token || tok.get('thread_user_jwt');
      const origGo = window.go;

      window.go = function(id) {
        const isAuth = !!(tok.get('thread_user_jwt'));
        // If user is already authenticated, block auth screens and redirect directly to Home Feed
        if (isAuth && (id === 'screen-onboarding' || id === 'screen-login' || id === 'screen-register' || id === 'screen-splash' || id === 'screen-forgot-email' || id === 'screen-reset-password')) {
          id = 'screen-feed';
        }
        if (origGo) return origGo(id);
      };

      const hideSplashSmoothly = (callback) => {
        const sp = document.getElementById('screen-splash');
        const lp = document.getElementById('launch-page');
        document.documentElement.classList.remove('thread-booting');
        
        if (lp) lp.classList.add('finished');
        if (callback) callback();
        if (sp) sp.classList.add('active'); // ensure it stays active during transition
        
        setTimeout(() => {
          if (sp) sp.classList.remove('active');
          if (lp) lp.classList.remove('finished');
        }, 350);
      };

      if (activeToken) {
        // Validate session with backend /auth/me
        call('/auth/me', { token: activeToken })
          .then((res) => {
            if (res && res.user) {
              tok.set('thread_user_data', JSON.stringify(res.user));
              updateProfileUI(res.user);
            }
            initChatClient(activeToken);

            if (typeof window.finishAuthentication === 'function') {
              window.finishAuthentication();
            }
            hideSplashSmoothly();
          })
          .catch((err) => {
            console.warn('Session expired or invalid, directing to login:', err);
            tok.del('thread_user_jwt');
            tok.del('thread_user_data');
            try { sessionStorage.removeItem('thread-authenticated'); } catch(e) {}
            if (onTokenChange) onTokenChange(null);
            
            hideSplashSmoothly(() => {
              if (origGo) origGo('screen-onboarding');
            });
          });
      } else {
        // No session exists, go straight to login
        hideSplashSmoothly(() => {
          if (origGo) origGo('screen-onboarding');
        });
      }

      // ─── LOGOUT HANDLER ───────────────────────────────────────────────────
      window.stLogout = async function() {
        try {
          await call('/auth/logout', { method: 'POST' });
        } catch (e) {}
        if (typeof window.closeSheet === 'function') window.closeSheet('set-sheet');
        tok.del('thread_user_jwt');
        tok.del('thread_user_data');
        try { sessionStorage.removeItem('thread-authenticated'); } catch(e) {}
        if (onTokenChange) onTokenChange(null);
        if (origGo) origGo('screen-onboarding');
      };

      // ─── REDIRECT / FINISH AUTHENTICATION TO HOME ──────────────────────────
      window.finishAuthentication = function(mode) {
        clearTimeout(window.__threadAuthHomeTimer);
        try { sessionStorage.setItem('thread-authenticated', '1'); } catch(e) {}
        try { document.querySelectorAll('.screen').forEach(s => s.classList.remove('active')); } catch(e) {}

        const home = document.getElementById('screen-feed') || document.getElementById('screen-home');
        const chat = document.getElementById('screen-chatwindow');
        if (chat) chat.classList.remove('active');
        if (home) home.classList.add('active');

        try {
          if (typeof window.renderStories === 'function') window.renderStories();
          if (typeof window.renderPosts === 'function') window.renderPosts();
          if (typeof window.renderFeed === 'function') window.renderFeed();
          if (typeof window.renderChats === 'function') window.renderChats();
        } catch(e) {}
      };

      // ─── ADD POST BUTTONS SYNC & OBSERVER ─────────────────────────────────
      const topBtn = document.getElementById('ap-go');
      const botBtn = document.getElementById('ap-go-bottom');
      const botText = document.getElementById('ap-go-bottom-text');
      const fileInp = document.getElementById('ap-file');

      function syncPostButtons() {
        if (!topBtn) return;
        if (botBtn) botBtn.disabled = topBtn.disabled;
        if (botText) {
          botText.textContent = topBtn.textContent === 'Posting…' ? 'Posting…' : 'Share Post';
        }
      }

      if (fileInp) {
        fileInp.addEventListener('change', function() {
          setTimeout(syncPostButtons, 60);
        });
      }

      if (topBtn) {
        const obs = new MutationObserver(() => {
          syncPostButtons();
        });
        obs.observe(topBtn, { attributes: true, childList: true, characterData: true, subtree: true });
      }

      const origOpenAddPost = window.openAddPost;
      window.openAddPost = function(kind) {
        if (origOpenAddPost) origOpenAddPost(kind);
        setTimeout(syncPostButtons, 60);
      };

      // ─── 1. SUBMIT REGISTER (SIGN UP FLOW WITH EMAIL OTP) ──────────────
      window.submitRegister = async function(e) {
        if (e && e.preventDefault) e.preventDefault();
        setErrMsg('screen-register', 'reg-err', '');

        const name = document.getElementById('reg-name')?.value?.trim() || 'User';
        const email = document.getElementById('reg-email')?.value?.trim().toLowerCase() || '';
        const password = document.getElementById('reg-pass')?.value || '';
        const confirmPassword = document.getElementById('reg-confirm-pass')?.value || '';

        if (!email) {
          setErrMsg('screen-register', 'reg-err', 'Please enter a valid email address.');
          return;
        }

        const r = evaluatePassword(password);
        if (!r.len || !r.upper || !r.lower || !r.num || !r.spec) {
          setErrMsg('screen-register', 'reg-err', 'Password must satisfy all requirements below.');
          return;
        }

        if (password !== confirmPassword) {
          setErrMsg('screen-register', 'reg-err', 'Passwords do not match.');
          return;
        }

        const btn = document.getElementById('reg-submit-btn');
        const origBtnText = btn ? btn.textContent : 'Create Account';
        if (btn) { btn.disabled = true; btn.textContent = 'Sending email code…'; }

        try {
          const res = await call('/auth/register', {
            method: 'POST',
            body: { name, email, password, confirmPassword }
          });

          _pendingReg = { name, email, password, confirmPassword };
          window.otpContext = 'register';

          const goFn = window.go || (typeof go !== 'undefined' ? go : null);
          if (goFn) {
            goFn('screen-otp');
            const titleEl = document.getElementById('otp-title');
            if (titleEl) titleEl.textContent = 'Verify your email';
            const copyEl = document.getElementById('otp-copy');
            if (copyEl) copyEl.textContent = `Enter the 6-digit code sent to ${email}`;
            const errEl = document.getElementById('otp-err-msg');
            if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }
            startOtpCountdown(60);
          }
        } catch (err) {
          console.error('Registration error:', err);
          setErrMsg('screen-register', 'reg-err', err.message || 'Signup failed. Please try again.');
        } finally {
          if (btn) { btn.disabled = false; btn.textContent = origBtnText; }
        }
      };

      // ─── 2. SUBMIT LOGIN (CREDENTIAL CHECK ONLY) ──────────────────
      window.submitLogin = async function(e) {
        if (e && e.preventDefault) e.preventDefault();
        setErrMsg('screen-login', 'login-err', '');

        const email = document.getElementById('login-email')?.value?.trim().toLowerCase() || '';
        const password = document.getElementById('login-pass')?.value || '';

        if (!email || !password) {
          setErrMsg('screen-login', 'login-err', 'Please enter your email and password.');
          return;
        }

        const btn = document.getElementById('login-submit-btn');
        const origBtnText = btn ? btn.textContent : 'Log In';
        if (btn) { btn.disabled = true; btn.textContent = 'Logging in…'; }

        try {
          const res = await call('/auth/login', {
            method: 'POST',
            body: { email, password }
          });

          if (res && res.token) {
            tok.set('thread_user_jwt', res.token);
            if (res.user) {
              tok.set('thread_user_data', JSON.stringify(res.user));
              updateProfileUI(res.user);
            }
            if (onTokenChange) onTokenChange(res.token);
            setTimeout(() => initChatClient(res.token), 100);
            if (typeof window.finishAuthentication === 'function') {
              window.finishAuthentication('login');
            } else {
              const goFn = window.go || (typeof go !== 'undefined' ? go : null);
              if (goFn) goFn('screen-feed');
            }
            }
          } catch (err) {
          console.error('Login error:', err);
          setErrMsg('screen-login', 'login-err', err.message || 'Invalid email or password.');
        } finally {
          if (btn) { btn.disabled = false; btn.textContent = origBtnText; }
        }
      };

      // ─── 3. RESEND OTP HANDLER ─────────────────────────────────────────────
      window.resendOtpCode = async function() {
        const errEl = document.getElementById('otp-err-msg');
        let targetEmail = '';
        let purpose = 'SIGNUP';

        if (window.otpContext === 'reset') {
          targetEmail = _resetEmail;
          purpose = 'PASSWORD_RESET';
        } else {
          targetEmail = _pendingReg.email;
          purpose = 'SIGNUP';
        }

        const resendBtn = document.getElementById('otp-resend-btn');
        if (resendBtn) resendBtn.textContent = 'Sending…';

        try {
          const res = await call('/auth/resend-otp', {
            method: 'POST',
            body: { email: targetEmail, purpose }
          });

          if (errEl) {
            errEl.textContent = res.message || 'A new verification code has been sent to your email.';
            errEl.style.display = 'block';
            errEl.style.color = '#4caf50';
          }
          startOtpCountdown(60);
        } catch (err) {
          if (errEl) {
            errEl.textContent = err.message || 'Could not resend code. Please try again.';
            errEl.style.display = 'block';
            errEl.style.color = '#ff4d4f';
          }
        } finally {
          if (resendBtn) resendBtn.textContent = 'Resend Code';
        }
      };

      // ─── 4. VERIFY OTP (SIGNUP OR RESET) ───────────────────────────
      window.checkOtp = async function(val) {
        const row = document.getElementById('otp-row');
        const otpInputs = Array.from(document.querySelectorAll('.otp-box'));
        const errEl = document.getElementById('otp-err-msg');
        const verifyBtn = document.getElementById('otp-verify-btn');

        if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }
        if (verifyBtn) { verifyBtn.disabled = true; verifyBtn.textContent = 'Verifying…'; }

        if (window.otpContext === 'register') {
          try {
            const res = await call('/auth/verify-email', {
              method: 'POST',
              body: {
                email: _pendingReg.email,
                otp: val
              }
            });

            if (res && res.token) {
              clearInterval(_otpCountdownTimer);
              otpInputs.forEach(i => i.classList.add('correct'));
              tok.set('thread_user_jwt', res.token);
              if (res.user) {
                tok.set('thread_user_data', JSON.stringify(res.user));
                updateProfileUI(res.user);
              }
              if (onTokenChange) onTokenChange(res.token);
              setTimeout(() => initChatClient(res.token), 100);

              setTimeout(() => {
                const goFn = window.go || (typeof go !== 'undefined' ? go : null);
                if (goFn) goFn('screen-account-created');
              }, 400);
              return;
            }
          } catch (err) {
            console.error('Signup OTP verify error:', err);
            if (errEl) {
              errEl.textContent = err.message || 'Invalid verification code.';
              errEl.style.display = 'block';
              errEl.style.color = '#ff4d4f';
            }
          } finally {
            if (verifyBtn) { verifyBtn.disabled = false; verifyBtn.textContent = 'Verify Code'; }
          }
        } else if (window.otpContext === 'reset') {
          try {
            const res = await call('/auth/verify-reset-otp', {
              method: 'POST',
              body: { email: _resetEmail, otp: val }
            });

            if (res && res.valid) {
              clearInterval(_otpCountdownTimer);
              _resetOtp = val;
              otpInputs.forEach(i => i.classList.add('correct'));
              setTimeout(() => {
                const goFn = window.go || (typeof go !== 'undefined' ? go : null);
                if (goFn) goFn('screen-reset-password');
              }, 400);
              return;
            }
          } catch (err) {
            console.error('Reset OTP verify error:', err);
            if (errEl) {
              errEl.textContent = err.message || 'Invalid or expired verification code.';
              errEl.style.display = 'block';
              errEl.style.color = '#ff4d4f';
            }
          } finally {
            if (verifyBtn) { verifyBtn.disabled = false; verifyBtn.textContent = 'Verify Code'; }
          }
        }
        
        otpInputs.forEach(i => i.classList.add('wrong'));
        if (row) row.classList.add('shake');
        setTimeout(() => {
          if (row) row.classList.remove('shake');
          otpInputs.forEach(i => { i.classList.remove('wrong'); i.value = ''; });
          otpInputs[0]?.focus();
        }, 500);
      };

      // ─── 5. GOOGLE AUTH (REAL MONGODB PERSISTENCE) ──────────────────────────
      window.handleGoogleAuth = async (account) => {
        const goFn = window.go || (typeof go !== 'undefined' ? go : null);

        try {
          const res = await call('/auth/google', {
            method: 'POST',
            body: {
              name: account.name,
              email: account.email,
              avatar: account.avatar || '',
              accessToken: account.accessToken
            }
          });

          if (res && res.token) {
            tok.set('thread_user_jwt', res.token);
            if (res.user) {
              tok.set('thread_user_data', JSON.stringify(res.user));
              updateProfileUI(res.user);
            }
            if (onTokenChange) onTokenChange(res.token);
            setTimeout(() => initChatClient(res.token), 100);

            // Always go to feed — works for both new and returning Google users
            if (typeof window.finishAuthentication === 'function') {
              window.finishAuthentication('google');
            } else if (goFn) {
              goFn('screen-feed');
            }
          }
        } catch (err) {
          console.error('Google Auth error:', err);
          // Restore button state
          document.querySelectorAll('.btn-google').forEach(b => {
            b.disabled = false;
            b.style.opacity = '';
            b.style.pointerEvents = '';
          });
          // Show error in the active screen
          const activeErr = document.querySelector('.screen.active .err');
          if (activeErr) {
            activeErr.textContent = err.message || 'Google sign-in failed. Please try again.';
            activeErr.style.display = 'block';
            activeErr.style.color = '#ff4d4f';
          }
        }
      };

      const _setGoogleButtonLoading = (loading) => {
        document.querySelectorAll('.btn-google').forEach(b => {
          b.disabled = loading;
          b.style.opacity = loading ? '0.65' : '';
          b.style.pointerEvents = loading ? 'none' : '';
        });
      };

      window.socialLogin = function() {
        _setGoogleButtonLoading(true);
        triggerGoogleLogin();
      };

      window.socialRegister = function() {
        _setGoogleButtonLoading(true);
        triggerGoogleLogin();
      };

      // ─── 6. FORGOT PASSWORD (SUBMIT EMAIL FOR RESET CODE) ───────────────────
      window.submitForgotEmail = async function(e) {
        if (e && e.preventDefault) e.preventDefault();
        setErrMsg('screen-forgot-email', 'forgot-err', '');

        const emailInp = document.getElementById('forgot-email');
        const email = emailInp?.value?.trim().toLowerCase() || '';

        if (!email) {
          setErrMsg('screen-forgot-email', 'forgot-err', 'Please enter your email address.');
          return;
        }

        const btn = document.getElementById('forgot-submit-btn');
        const origBtnText = btn ? btn.textContent : 'Send Code';
        if (btn) { btn.disabled = true; btn.textContent = 'Sending code…'; }

        try {
          const res = await call('/auth/forgot-password', {
            method: 'POST',
            body: { email }
          });

          _resetEmail = email;
          window.otpContext = 'reset';

          const goFn = window.go || (typeof go !== 'undefined' ? go : null);
          if (goFn) {
            goFn('screen-otp');
            const titleEl = document.getElementById('otp-title');
            if (titleEl) titleEl.textContent = 'Verify Reset Code';
            const copyEl = document.getElementById('otp-copy');
            if (copyEl) copyEl.textContent = `Enter the 6-digit code sent to ${email}`;
            const errEl = document.getElementById('otp-err-msg');
            if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }
            startOtpCountdown(60);
          }
        } catch (err) {
          console.error('Forgot password error:', err);
          setErrMsg('screen-forgot-email', 'forgot-err', err.message || 'Could not send verification code.');
        } finally {
          if (btn) { btn.disabled = false; btn.textContent = origBtnText; }
        }
      };

      // ─── 7. RESET PASSWORD (UPDATE IN MONGODB & SHOW SUCCESS CARD) ─────────
      window.submitReset = async function(e) {
        if (e && e.preventDefault) e.preventDefault();
        const errEl = document.getElementById('reset-error');
        if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }

        const newPass = document.getElementById('new-pass')?.value || '';
        const confPass = document.getElementById('confirm-pass')?.value || '';

        const r = evaluatePassword(newPass);
        if (!r.len || !r.upper || !r.lower || !r.num || !r.spec) {
          if (errEl) {
            errEl.textContent = 'Password must satisfy all requirements below.';
            errEl.style.display = 'block';
            errEl.style.color = '#ff4d4f';
          }
          return;
        }

        if (newPass !== confPass) {
          if (errEl) {
            errEl.textContent = 'Passwords do not match.';
            errEl.style.display = 'block';
            errEl.style.color = '#ff4d4f';
          }
          return;
        }

        const btn = document.getElementById('reset-submit-btn');
        const origBtnText = btn ? btn.textContent : 'Update Password';
        if (btn) { btn.disabled = true; btn.textContent = 'Updating password…'; }

        try {
          const res = await call('/auth/reset-password', {
            method: 'POST',
            body: {
              email: _resetEmail,
              otp: _resetOtp,
              password: newPass,
              confirmPassword: confPass
            }
          });

          const goFn = window.go || (typeof go !== 'undefined' ? go : null);
          if (goFn) {
            goFn('screen-password-updated');
          } else {
            const modal = document.getElementById('pw-modal');
            if (modal) modal.classList.add('show');
          }
        } catch (err) {
          console.error('Reset password error:', err);
          if (errEl) {
            errEl.textContent = err.message || 'Password reset failed.';
            errEl.style.display = 'block';
            errEl.style.color = '#ff4d4f';
          }
        } finally {
          if (btn) { btn.disabled = false; btn.textContent = origBtnText; }
        }
      };
    };

    bootApp();
  }, [token]);

  return <div ref={containerRef} style={{width:'100%', height:'100%'}} />;
}
