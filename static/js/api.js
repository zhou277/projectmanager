// projectmanager 3.21.0 — api
// Classic script: shared globals preserve existing HTML event handlers.
async function api(url,opt={}){let r=await fetch(url,{headers:{"Content-Type":"application/json"},...opt});if(!r.ok)throw new Error(await r.text());let t=await r.text();try{return JSON.parse(t)}catch{return t}}
