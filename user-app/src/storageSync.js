import {call} from './api';
// Hydrates localStorage from MongoDB before the UI boots and mirrors every later write back (debounced).
export async function hydrate(path,token){
  const s=await call(path,{token});
  Object.entries(s||{}).forEach(([k,v])=>Storage.prototype.setItem.call(localStorage,k,v));
}
export function startPush(path,token,accept){
  const set=Storage.prototype.setItem,rem=Storage.prototype.removeItem;let t,dirty={};
  const flush=()=>{const b=dirty;dirty={};call(path,{method:'PUT',body:b,token}).catch(e=>console.warn('sync failed',e))};
  Storage.prototype.setItem=function(k,v){set.call(this,k,v);if(this===localStorage&&accept(k)){dirty[k]=String(v);clearTimeout(t);t=setTimeout(flush,700)}};
  Storage.prototype.removeItem=function(k){rem.call(this,k);if(this===localStorage&&accept(k)){dirty[k]=null;clearTimeout(t);t=setTimeout(flush,700)}};
  window.addEventListener('pagehide',flush);
}
