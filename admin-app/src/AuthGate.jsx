import {useState} from 'react';
import {call,tok} from './api';
const box={minHeight:'100vh',display:'grid',placeItems:'center',background:'#0d1326',color:'#f1ead8',fontFamily:'system-ui,sans-serif'};
const inp={display:'block',width:'100%',margin:'8px 0',padding:'12px',borderRadius:10,border:'1px solid #33406b',background:'#151d38',color:'inherit'};
const btn={width:'100%',padding:12,border:0,borderRadius:10,background:'#ff6b4a',color:'#fff',fontWeight:600,cursor:'pointer'};
export default function AuthGate({mode,onAuth}){
  const admin=mode==='admin';const [m,setM]=useState('login');const [f,setF]=useState({name:'',email:'',password:''});const [err,setErr]=useState('');
  const go=async e=>{e.preventDefault();setErr('');try{
    const r=admin?await call('/admin/login',{method:'POST',body:{password:f.password}}):await call('/auth/'+(m==='login'?'login':'signup'),{method:'POST',body:f});
    tok.set(admin?'thread_admin_jwt':'thread_user_jwt',r.token);onAuth(r.token)}catch(x){setErr(x.message)}};
  return <div style={box}><form onSubmit={go} style={{width:320}}>
    <h2>{admin?'Thread Admin':'Thread'}</h2>
    {!admin&&m==='signup'&&<input style={inp} placeholder="Name" value={f.name} onChange={e=>setF({...f,name:e.target.value})}/>}
    {!admin&&<input style={inp} type="email" placeholder="Email" value={f.email} onChange={e=>setF({...f,email:e.target.value})}/>}
    <input style={inp} type="password" placeholder="Password" value={f.password} onChange={e=>setF({...f,password:e.target.value})}/>
    {err&&<p style={{color:'#ff8a7a'}}>{err}</p>}
    <button style={btn}>{admin?'Sign in':m==='login'?'Log in':'Create account'}</button>
    {!admin&&<p style={{textAlign:'center',cursor:'pointer'}} onClick={()=>setM(m==='login'?'signup':'login')}>{m==='login'?'New here? Sign up':'Have an account? Log in'}</p>}
  </form></div>;
}
