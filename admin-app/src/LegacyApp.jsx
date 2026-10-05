import {useEffect,useRef} from 'react';
import body from './legacy/body.html?raw';
import scripts from './legacy/scripts.json';
import ext from './legacy/ext.json';
import './legacy/legacy.css';
import {initAdminClient} from './adminClient';
import {tok, call} from './api';

function run(code){const s=document.createElement('script');s.text=code;document.body.appendChild(s);s.remove()}
function load(src){return new Promise(r=>{const s=document.createElement('script');s.src=src;s.onload=s.onerror=r;document.head.appendChild(s)})}

// Original UI (markup + behaviour) hosted inside a React component.
export default function LegacyApp({token, onTokenChange}){
  const ref=useRef(null);
  useEffect(()=>{
    let dead=false;
    (async()=>{
      for(const u of ext){if(dead)return;await load(u)}
      for(const c of scripts){if(dead)return;try{run(c)}catch(e){console.error(e)}}
      document.dispatchEvent(new Event('DOMContentLoaded'));
      window.dispatchEvent(new Event('load'));

      // Connect admin panel to real MongoDB users and moderation APIs
      const activeToken = token || tok.get('thread_admin_jwt');
      if(activeToken){
        setTimeout(()=>initAdminClient(activeToken), 100);
      }

      // Non-intrusively hook admin login button to backend
      const emailInput = document.getElementById('lg-email');
      const pwInput = document.getElementById('pw');
      const nameInput = document.getElementById('lg-name');
      const pwConfirm = document.getElementById('pw-confirm');
      const loginBtn = document.getElementById('lg-btn');

      window.adminMode = 'login';
      window.toggleAdminMode = (e) => {
        if(e) e.preventDefault();
        window.adminMode = window.adminMode === 'login' ? 'register' : 'login';
        const regF = document.getElementById('reg-fields');
        const regFp = document.getElementById('reg-fields-pw');
        if(regF) regF.style.display = window.adminMode === 'register' ? 'flex' : 'none';
        if(regFp) regFp.style.display = window.adminMode === 'register' ? 'block' : 'none';
        if(loginBtn) loginBtn.textContent = window.adminMode === 'register' ? 'Create Admin Account' : 'Sign in';
        const sub = document.getElementById('lg-sub');
        if(sub) sub.textContent = window.adminMode === 'register' ? 'Create a new admin account.' : 'Sign in to manage users, reports and announcements.';
        const tog = document.getElementById('lg-toggle');
        if(tog) tog.textContent = window.adminMode === 'register' ? 'Already have an account? Log in' : 'Need an account? Sign up';
        const errEl = document.getElementById('err');
        if(errEl) errEl.textContent = '';
      };

      window.doAdminAuth = async () => {
        const email = emailInput ? emailInput.value.trim() : '';
        const password = pwInput ? pwInput.value.trim() : '';
        const errEl = document.getElementById('err');
        
        if(window.adminMode === 'login') {
          if(email && password){
            if(loginBtn) { loginBtn.textContent = 'Signing in...'; loginBtn.disabled = true; }
            try{
              const res = await call('/admin/login', {method:'POST', body:{email, password}});
              if(res && res.token){
                tok.set('thread_admin_jwt', res.token);
                if(onTokenChange) onTokenChange(res.token);
                setTimeout(()=>initAdminClient(res.token), 100);
              }
            }catch(e){
              if(errEl) errEl.textContent = e.message || 'Login failed.';
            }finally{
              if(loginBtn) { loginBtn.textContent = 'Sign in'; loginBtn.disabled = false; }
            }
          } else {
            if(errEl) errEl.textContent = 'Email and password are required.';
          }
        } else {
          const name = nameInput ? nameInput.value.trim() : '';
          const confirmPassword = pwConfirm ? pwConfirm.value.trim() : '';
          if(email && password && confirmPassword){
            if(loginBtn) { loginBtn.textContent = 'Creating account...'; loginBtn.disabled = true; }
            try{
              const res = await call('/admin/register', {method:'POST', body:{name, email, password, confirmPassword}});
              if(res && res.token){
                tok.set('thread_admin_jwt', res.token);
                if(onTokenChange) onTokenChange(res.token);
                setTimeout(()=>initAdminClient(res.token), 100);
              }
            }catch(e){
              if(errEl) errEl.textContent = e.message || 'Registration failed.';
            }finally{
              if(loginBtn) { loginBtn.textContent = 'Create Admin Account'; loginBtn.disabled = false; }
            }
          } else {
            if(errEl) errEl.textContent = 'All fields are required.';
          }
        }
      };
    })();
    return()=>{dead=true};
  },[token]);

  return <div id="legacy-root" ref={ref} dangerouslySetInnerHTML={{__html:body}}/>;
}
