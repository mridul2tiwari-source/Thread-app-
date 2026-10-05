import { supabase } from './lib/supabaseClient';

// Hydrates localStorage from Supabase metadata before the UI boots and mirrors every later write back (debounced).
export async function hydrate(path, token) {
  const { data: { user } } = await supabase.auth.getUser();
  const s = user?.user_metadata?.state || {};
  Object.entries(s || {}).forEach(([k,v]) => Storage.prototype.setItem.call(localStorage, k, v));
}

export function startPush(path, token, accept) {
  const set = Storage.prototype.setItem, rem = Storage.prototype.removeItem;
  let t, dirty = {};
  
  const flush = async () => {
    const b = dirty;
    dirty = {};
    if (Object.keys(b).length === 0) return;
    
    // Fetch current state
    const { data: { user } } = await supabase.auth.getUser();
    let currentState = user?.user_metadata?.state || {};
    
    // Merge updates (null means delete)
    for (const k in b) {
      if (b[k] === null) delete currentState[k];
      else currentState[k] = b[k];
    }
    
    supabase.auth.updateUser({ data: { state: currentState } }).catch(e => console.warn('sync failed', e));
  };
  
  Storage.prototype.setItem = function(k, v) { set.call(this, k, v); if(this === localStorage && accept(k)) { dirty[k] = String(v); clearTimeout(t); t = setTimeout(flush, 700); } };
  Storage.prototype.removeItem = function(k) { rem.call(this, k); if(this === localStorage && accept(k)) { dirty[k] = null; clearTimeout(t); t = setTimeout(flush, 700); } };
  window.addEventListener('pagehide', flush);
}
