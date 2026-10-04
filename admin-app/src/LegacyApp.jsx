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
      const pwInput = document.getElementById('pw');
      const loginBtn = document.querySelector('#login button.btn');
      const doAdminAuth = async () => {
        const password = pwInput ? pwInput.value.trim() : '';
        if(password){
          try{
            const res = await call('/admin/login', {method:'POST', body:{password}});
            if(res && res.token){
              tok.set('thread_admin_jwt', res.token);
              if(onTokenChange) onTokenChange(res.token);
              setTimeout(()=>initAdminClient(res.token), 100);
            }
          }catch(e){
            console.warn('Admin backend login failed, continuing with local flow:', e);
          }
        }
      };

      if(loginBtn && !loginBtn._backendHooked){
        loginBtn._backendHooked = true;
        loginBtn.addEventListener('click', doAdminAuth);
      }
      if(pwInput && !pwInput._backendHooked){
        pwInput._backendHooked = true;
        pwInput.addEventListener('keydown', (e) => {
          if(e.key === 'Enter') doAdminAuth();
        });
      }
    })();
    return()=>{dead=true};
  },[token]);

  return <div id="legacy-root" ref={ref} dangerouslySetInnerHTML={{__html:body}}/>;
}
