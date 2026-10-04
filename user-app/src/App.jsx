import {useEffect,useState} from 'react';
import LegacyApp from './LegacyApp';
import {tok} from './api';
import {hydrate,startPush} from './storageSync';

export default function App(){
  const [token,setToken]=useState(tok.get('thread_user_jwt'));

  useEffect(()=>{
    if(!token) return;
    hydrate('/me/state',token)
      .then(()=>{
        startPush('/me/state',token,k=>k!=='sp_t');
      })
      .catch((err)=>{
        console.warn('Backend sync failed, continuing offline:', err);
      });
  },[token]);

  return <LegacyApp token={token} onTokenChange={setToken}/>;
}
