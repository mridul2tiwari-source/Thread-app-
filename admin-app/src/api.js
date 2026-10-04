const BASE=import.meta.env.VITE_API_URL||'/api';
export const tok={get:k=>localStorage.getItem(k),set:(k,v)=>Storage.prototype.setItem.call(localStorage,k,v),del:k=>localStorage.removeItem(k)};
export async function call(path,{method='GET',body,token}={}){
  const r=await fetch(BASE+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});
  if(!r.ok){let m='Request failed';try{m=(await r.json()).error||m}catch(e){}throw new Error(m)}
  return r.status===204?null:r.json();
}
