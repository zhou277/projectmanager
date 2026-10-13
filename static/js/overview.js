// projectmanager 3.21.0 — overview
// Classic script: shared globals preserve existing HTML event handlers.
function metric(k,v){return `<div class="metric"><div class="v">${esc(v)}</div><div class="k">${esc(k)}</div></div>`}

function taskMini(rows,pending){
 return `<table class="overview-task-table"><thead><tr><th>ID</th><th class="task-title-col">任务名称</th><th>软件版本</th>${pending?'<th>状态</th><th>优先级</th>':''}<th>截止日期</th></tr></thead><tbody>`+
 rows.map(x=>`<tr>${td(taskId(x.display_id),"center")}${td(esc(x.title))}${td(vers(x.versions),"center")}${pending?td(badge(x.status),"center")+td(esc(x.priority),"center"):""}${td(esc(x.due_date),"center")}</tr>`).join("")+"</tbody></table>"
}

function issueMini(rows){
 return `<table><thead><tr><th>ID</th><th>Issue</th><th>类型</th><th>严重度</th><th>状态</th></tr></thead><tbody>`+
 rows.map(x=>`<tr>${td(issueId(x.display_id),"center")}${td(esc(x.title))}${td(esc(x.issue_type),"center")}${td(esc(x.severity),"center")}${td(badge(x.status,"issue"),"center")}</tr>`).join("")+"</tbody></table>"
}

async function overview(){
 const projectId=S.projectId;
 try{
   const data=await api(`/api/dashboard/${projectId}`);
   if(S.tab==="overview"&&S.projectId===projectId)$("#content").innerHTML=dashboardHtml(data,false);
 }catch(error){
   if(S.tab==="overview"&&S.projectId===projectId)$("#content").innerHTML=`<div class="card">Dashboard 加载失败：${esc(error.message)} <button onclick="render()">重试</button></div>`;
 }
}
