// projectmanager 3.21.0 — settings
// Classic script: shared globals preserve existing HTML event handlers.
async function toggleTheme(){
 const theme=document.body.classList.contains("light")?"dark":"light";
 document.body.classList.toggle("light",theme==="light");
 localStorage.setItem("theme",theme);
 if(S.settings){
   S.settings.theme=theme;
   try{
     S.settings=await api("/api/settings",{method:"PUT",body:JSON.stringify(S.settings)});
   }catch(e){}
 }
}

async function settingsPage(){
 let s=await api("/api/settings");
 S.settings=s;
 $("#content").innerHTML=`
 <div class="settings-layout">
   <div class="card settings-card">
     <div class="settings-heading">
       <div>
         <h3>常规设置</h3>
         <div class="muted">设置会保存到本地配置文件。</div>
       </div>
     </div>
     <div class="settings-grid">
       <div>
         <label>主题</label>
         <select id="setting_theme">
           <option value="dark" ${s.theme==="dark"?"selected":""}>深色</option>
           <option value="light" ${s.theme==="light"?"selected":""}>浅色</option>
         </select>
       </div>
       <div>
         <label>默认端口</label>
         <input id="setting_port" type="number" min="1024" max="65535" value="${esc(s.preferred_port)}">
         <div class="field-help">当前端口：${esc(s.current_port??"-")}。修改默认端口后，下次启动生效。</div>
       </div>
       <div class="wide">
         <label>时区</label>
         <input value="${esc(s.timezone)}" disabled>
         <div class="field-help">当前项目时间统一使用 UTC+8。</div>
       </div>
     </div>
   </div>

   <div class="card settings-card">
     <div class="settings-heading">
       <div>
         <h3>数据备份</h3>
         <div class="muted">备份仅复制 SQLite 数据库，不改变现有项目数据。</div>
       </div>
       <button onclick="backupNow()">立即备份</button>
     </div>
     <div class="settings-grid">
       <div class="wide setting-checkbox-row">
         <label class="setting-switch">
           <input id="setting_auto_backup" type="checkbox" ${s.auto_backup?"checked":""}>
           <span>启动软件时自动备份数据库</span>
         </label>
       </div>
       <div class="wide">
         <label>备份目录</label>
         <input id="setting_backup_dir" value="${esc(s.backup_dir)}">
         <div class="field-help">相对路径会以 projectmanager 所在目录为基准。当前解析为：${esc(s.resolved_backup_dir)}</div>
       </div>
       <div>
         <label>最多保留备份数量</label>
         <input id="setting_backup_keep" type="number" min="1" max="100" value="${esc(s.backup_keep)}">
       </div>
     </div>
   </div>

   <div class="card settings-card">
     <h3>数据位置</h3>
     <div class="path-list">
       <div><span>数据库</span><code>${esc(s.database_path)}</code></div>
       <div><span>日志</span><code>${esc(s.log_path)}</code></div>
       <div><span>设置</span><code>${esc(s.settings_path)}</code></div>
     </div>
   </div>

   <div class="settings-actions">
     <button class="primary" onclick="saveSettings()">保存设置</button>
   </div>
 </div>`;
}

async function saveSettings(){
 const payload={
   theme:$("#setting_theme").value,
   preferred_port:Number($("#setting_port").value),
   auto_backup:$("#setting_auto_backup").checked,
   backup_dir:$("#setting_backup_dir").value.trim(),
   backup_keep:Number($("#setting_backup_keep").value)
 };
 try{
   const s=await api("/api/settings",{method:"PUT",body:JSON.stringify(payload)});
   S.settings=s;
   document.body.classList.toggle("light",s.theme==="light");
   localStorage.setItem("theme",s.theme);
   alert(s.restart_required?"设置已保存。默认端口将在下次启动时生效。":"设置已保存。");
   settingsPage();
 }catch(e){
   alert("保存设置失败："+e.message);
 }
}

async function backupNow(){
 try{
   const r=await api("/api/settings/backup",{method:"POST",body:"{}"});
   alert(`备份完成：\n${r.path}`);
   settingsPage();
 }catch(e){
   alert("备份失败："+e.message);
 }
}

async function aboutPage(){
 const a=await api("/api/about");
 $("#content").innerHTML=`
 <div class="about-shell">
   <div class="card about-hero">
     <img src="/static/app_icon.png" class="about-icon" alt="projectmanager">
     <div>
       <div class="about-name">${esc(a.name)}</div>
       <div class="about-version">Version ${esc(a.version)}</div>
       <div class="muted">面向机器人 / ROS 研发工作的本地项目管理工具</div>
     </div>
   </div>

   <div class="card">
     <h3>运行信息</h3>
     <div class="about-info-grid">
       <div><span>运行方式</span><strong>${esc(a.runtime)}</strong></div>
       <div><span>Python</span><strong>${esc(a.python)}</strong></div>
       <div><span>默认端口</span><strong>${esc(a.preferred_port)}</strong></div>
       <div><span>当前端口</span><strong>${esc(a.current_port??"-")}</strong></div>
       <div><span>时区</span><strong>${esc(a.timezone)}</strong></div>
     </div>
   </div>

   <div class="card">
     <h3>v${esc(a.version)} 更新内容</h3>
     <ul class="release-notes">${(a.release_notes||[]).map(x=>`<li>${esc(x)}</li>`).join("")}</ul>
   </div>

   <div class="card">
     <h3>文件位置</h3>
     <div class="path-list">
       <div><span>数据库</span><code>${esc(a.database_path)}</code></div>
       <div><span>日志</span><code>${esc(a.log_path)}</code></div>
       <div><span>设置</span><code>${esc(a.settings_path)}</code></div>
     </div>
   </div>
 </div>`;
}
