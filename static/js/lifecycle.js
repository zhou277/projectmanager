// projectmanager 3.21.0 — lifecycle
// Classic script: shared globals preserve existing HTML event handlers.
const CLIENT_TOKEN = crypto.randomUUID
  ? crypto.randomUUID()
  : `${Date.now()}-${Math.random()}`;

async function registerClient(){
  try{
    await fetch("/api/client/register",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({token:CLIENT_TOKEN}),
      keepalive:true
    });
  }catch(e){}
}

async function heartbeatClient(){
  try{
    await fetch("/api/client/heartbeat",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({token:CLIENT_TOKEN}),
      keepalive:true
    });
  }catch(e){}
}

function notifyClientClosed(){
  try{
    const blob=new Blob(
      [JSON.stringify({token:CLIENT_TOKEN})],
      {type:"application/json"}
    );
    navigator.sendBeacon("/api/client/close",blob);
  }catch(e){}
}

async function exitApplication(){
  if(!confirm("确定要完全退出 projectmanager 吗？\n\n退出后本地服务会停止，当前网页将无法继续使用。")) return;

  try{
    await api("/api/shutdown",{method:"POST",body:"{}"});
  }catch(e){
    // The server may close the connection during shutdown; continue to exit screen.
  }

  document.body.innerHTML = `
    <div class="shutdown-screen">
      <div class="shutdown-card">
        <div class="shutdown-icon">✓</div>
        <h1>软件已退出</h1>
        <p>projectmanager 本地服务已经停止。</p>
        <p class="muted">现在可以安全关闭这个浏览器页面。</p>
      </div>
    </div>
  `;
}
