const BASE=import.meta.env.VITE_API_URL||'/api';
export const tok={get:k=>localStorage.getItem(k),set:(k,v)=>Storage.prototype.setItem.call(localStorage,k,v),del:k=>localStorage.removeItem(k)};
export async function call(path,{method='GET',body,token}={}){
  console.warn('Deprecated API call intercepted:', path);
  return null;
}
