import {useEffect,useState} from 'react';
import ThreadAdmin from './ThreadAdmin';
import {tok} from './api';
import {hydrate,startPush} from './storageSync';

export default function App(){
  const [token,setToken]=useState(tok.get('thread_admin_jwt'));

  useEffect(()=>{
    if(!token) return;
    hydrate('/admin/state',token)
      .then(()=>{
        startPush('/admin/state',token,k=>k==='thread-admin-v1');
      })
      .catch((err)=>{
        console.warn('Admin backend sync failed, continuing offline:', err);
      });
  },[token]);

  return <ThreadAdmin token={token} onTokenChange={setToken}/>;
}
