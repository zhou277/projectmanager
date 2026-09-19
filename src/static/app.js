let S={projectId:null,projects:[],tab:"overview",selected:null,sort:"status",hideCompleted:localStorage.getItem("hideCompletedTasks")==="1"};

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

window.addEventListener("pagehide",notifyClientClosed);
window.addEventListener("pageshow",()=>registerClient());
registerClient();
setInterval(heartbeatClient,15000);
const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));

function markdownInline(source){
  let text=String(source??"");
  const codeSpans=[];
  text=text.replace(/`([^`]+)`/g,(_,code)=>{
    const key=`@@CODE${codeSpans.length}@@`;
    codeSpans.push(`<code>${esc(code)}</code>`);
    return key;
  });

  text=esc(text);

  text=text.replace(/\[([^\]]+)\]\(([^)]+)\)/g,(m,label,url)=>{
    const decoded=String(url).replace(/&amp;/g,"&").trim();
    if(!/^(https?:\/\/|mailto:)/i.test(decoded)) return m;
    return `<a href="${esc(decoded)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });
  text=text.replace(/\*\*([^*]+)\*\*/g,"<strong>$1</strong>");
  text=text.replace(/__([^_]+)__/g,"<strong>$1</strong>");
  text=text.replace(/(^|[^*])\*([^*\n]+)\*/g,"$1<em>$2</em>");
  text=text.replace(/(^|[^_])_([^_\n]+)_/g,"$1<em>$2</em>");

  codeSpans.forEach((html,i)=>{
    text=text.replace(`@@CODE${i}@@`,html);
  });
  return text;
}

function renderMarkdown(source){
  const input=String(source??"").replace(/\r\n?/g,"\n");
  if(!input.trim()) return '<span class="muted">暂无备注</span>';

  const parts=input.split(/```/);
  let html="";

  for(let partIndex=0;partIndex<parts.length;partIndex++){
    const part=parts[partIndex];
    if(partIndex%2===1){
      let code=part;
      const firstNl=code.indexOf("\n");
      if(firstNl>=0){
        const maybeLang=code.slice(0,firstNl).trim();
        if(/^[a-zA-Z0-9_+.#-]{1,20}$/.test(maybeLang)) code=code.slice(firstNl+1);
      }
      html+=`<pre><code>${esc(code.replace(/^\n|\n$/g,""))}</code></pre>`;
      continue;
    }

    const lines=part.split("\n");
    let paragraph=[];
    let listType=null;
    let listItems=[];

    const flushParagraph=()=>{
      if(!paragraph.length) return;
      html+=`<p>${paragraph.map(markdownInline).join("<br>")}</p>`;
      paragraph=[];
    };
    const flushList=()=>{
      if(!listItems.length) return;
      const tag=listType||"ul";
      html+=`<${tag}>${listItems.map(x=>`<li>${markdownInline(x)}</li>`).join("")}</${tag}>`;
      listItems=[];
      listType=null;
    };

    for(const line of lines){
      const trimmed=line.trim();
      if(!trimmed){
        flushParagraph();
        flushList();
        continue;
      }

      const heading=trimmed.match(/^(#{1,6})\s+(.+)$/);
      if(heading){
        flushParagraph(); flushList();
        const level=heading[1].length;
        html+=`<h${level}>${markdownInline(heading[2])}</h${level}>`;
        continue;
      }

      const ul=trimmed.match(/^[-*+]\s+(.+)$/);
      if(ul){
        flushParagraph();
        if(listType && listType!=="ul") flushList();
        listType="ul";
        listItems.push(ul[1]);
        continue;
      }

      const ol=trimmed.match(/^\d+[.)]\s+(.+)$/);
      if(ol){
        flushParagraph();
        if(listType && listType!=="ol") flushList();
        listType="ol";
        listItems.push(ol[1]);
        continue;
      }

      if(listItems.length) flushList();
      paragraph.push(line);
    }
    flushParagraph();
    flushList();
  }

  return html;
}

function notePreview(note,maxLen=72){
  const plain=String(note??"").replace(/```[\s\S]*?```/g," [代码] ")
    .replace(/[*_`#>-]/g," ")
    .replace(/\s+/g," ").trim();
  if(!plain) return "暂无备注";
  return plain.length>maxLen ? plain.slice(0,maxLen)+"…" : plain;
}

function toggleVersionNote(id){
  const row=document.getElementById(`version-note-${id}`);
  const btn=document.querySelector(`[data-version-note-btn="${id}"]`);
  if(!row) return;
  const hidden=row.classList.toggle("hidden");
  if(btn) btn.textContent=hidden?"展开":"收起";
}
async function api(url,opt={}){let r=await fetch(url,{headers:{"Content-Type":"application/json"},...opt});if(!r.ok)throw new Error(await r.text());let t=await r.text();try{return JSON.parse(t)}catch{return t}}
function td(v,c=""){return `<td class="${c}">${v??""}</td>`}
function taskId(n){return `Task-${n}`}
function issueId(n){return `Issue-${n}`}
function badge(s,type="task"){let c=type==="issue"?(s==="Open"?"red":(["Closed","Resolved"].includes(s)?"green":s==="In Progress"?"yellow":s==="Blocked"?"orange":"blue")):(s==="已完成"?"green":s==="进行中"?"yellow":s==="阻塞"?"orange":"blue");return `<span class="badge ${c}">${esc(s)}</span>`}
function vers(v){return (v||[]).map(x=>`<span class="version-chip">${esc(x)}</span>`).join("")}
function sel(id,el){document.querySelectorAll(".row-selected").forEach(x=>x.classList.remove("row-selected"));el.classList.add("row-selected");S.selected=id}
function clickRow(id){return `onclick="sel(${id},this)"`}
function taskRowEvents(id){return `onclick="sel(${id},this)" ondblclick="sel(${id},this);taskDialog(true)"`}
function issueRowEvents(id){return `onclick="sel(${id},this)" ondblclick="sel(${id},this);issueDialog(true)"`}
function testRowEvents(id){return `onclick="sel(${id},this)" ondblclick="sel(${id},this);testDialog(true)"`}
function versionRowEvents(id){return `onclick="sel(${id},this)" ondblclick="sel(${id},this);versionDialog(true)"`}
function toggleTheme(){document.body.classList.toggle("light");localStorage.setItem("theme",document.body.classList.contains("light")?"light":"dark")}
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
if(localStorage.getItem("theme")==="light")document.body.classList.add("light");

async function loadProjects(){
 S.projects=await api("/api/projects");
 $("#projectList").innerHTML=S.projects.map(p=>`<div class="project-item ${p.id===S.projectId?"active":""}" onclick="selectProject(${p.id})">${esc(p.name)}</div>`).join("");
 if(!S.projectId&&S.projects[0])await selectProject(S.projects[0].id);
}
async function selectProject(id){
 S.projectId=id;S.selected=null;let p=S.projects.find(x=>x.id===id);
 $("#projectTitle").textContent=p?.name||"";
 $("#projectMeta").textContent=[p?.owner,p?.start_date&&`开始 ${p.start_date}`,p?.target_date&&`目标 ${p.target_date}`].filter(Boolean).join(" · ");
 $("#projectList").innerHTML=S.projects.map(x=>`<div class="project-item ${x.id===id?"active":""}" onclick="selectProject(${x.id})">${esc(x.name)}</div>`).join("");
 render();
}
document.querySelectorAll(".tabs button").forEach(b=>b.onclick=()=>{document.querySelectorAll(".tabs button").forEach(x=>x.classList.remove("active"));b.classList.add("active");S.tab=b.dataset.tab;S.selected=null;render()});

async function render(){
 if(!S.projectId){$("#content").innerHTML='<div class="card">请先新建项目。</div>';return}
 if(S.tab==="overview")return overview();
 if(S.tab==="tasks")return tasks();
 if(S.tab==="issues")return issues();
 if(S.tab==="tests")return tests();
 if(S.tab==="versions")return versions();
 if(S.tab==="logs")return logs();
 if(S.tab==="gantt")return gantt();
 if(S.tab==="reports")return reports();
}
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
 let d=await api(`/api/dashboard/${S.projectId}`);
 $("#content").innerHTML=`<div class="metrics">${metric("项目进度",d.progress+"%")}${metric("任务总数",d.task_total)}${metric("已完成",d.task_done)}${metric("未关闭 Issue",d.open_issues)}${metric("测试通过 / 失败",d.tests_passed+" / "+d.tests_failed)}</div>
 <div class="overview-task-stack">
   <div class="card"><h3>当前待做任务</h3>${taskMini(d.pending,true)}</div>
   <div class="card"><h3>已完成任务</h3>${taskMini(d.completed,false)}</div>
 </div>
 <div class="card" style="margin-top:14px"><h3>当前高风险 Issue</h3>${issueMini(d.risky_issues)}</div>`;
}

function taskDescendantIds(rows, rootId){
  const children=new Map();
  for(const r of rows){
    if(r.parent_id!=null){
      if(!children.has(r.parent_id)) children.set(r.parent_id,[]);
      children.get(r.parent_id).push(r.id);
    }
  }
  const result=new Set();
  const stack=[rootId];
  while(stack.length){
    const cur=stack.pop();
    for(const child of (children.get(cur)||[])){
      if(!result.has(child)){
        result.add(child);
        stack.push(child);
      }
    }
  }
  return result;
}

function taskParentOptions(rows,currentTask){
  const excluded=currentTask ? taskDescendantIds(rows,currentTask.id) : new Set();
  if(currentTask) excluded.add(currentTask.id);

  const options=[`<option value="" ${!currentTask?.parent_id?"selected":""}>无（顶级任务）</option>`];
  for(const r of rows){
    if(excluded.has(r.id)) continue;
    options.push(
      `<option value="${r.id}" ${currentTask?.parent_id===r.id?"selected":""}>${r.display_id} · ${esc(r.title)}</option>`
    );
  }
  return options.join("");
}

function hierarchyRows(rows){
  const byId=new Map(rows.map(r=>[r.id,r]));
  const children=new Map();
  const roots=[];

  for(const r of rows){
    if(r.parent_id && byId.has(r.parent_id)){
      if(!children.has(r.parent_id)) children.set(r.parent_id,[]);
      children.get(r.parent_id).push(r);
    }else{
      roots.push(r);
    }
  }

  const result=[];
  const visited=new Set();

  function walk(node,depth){
    if(visited.has(node.id)) return;
    visited.add(node.id);
    result.push({...node,_depth:depth});
    for(const child of (children.get(node.id)||[])) walk(child,depth+1);
  }

  for(const root of roots) walk(root,0);
  for(const r of rows) if(!visited.has(r.id)) walk(r,0);
  return result;
}

function taskTitleTreeHtml(x){
  const depth=x._depth||0;
  const prefix=depth>0?`<span class="task-tree-branch">└─</span>`:"";
  return `<div class="task-tree-title" style="--task-depth:${depth}">${prefix}<span>${esc(x.title)}</span></div>`;
}

function toggleCompletedTasks(){
  S.hideCompleted=!S.hideCompleted;
  localStorage.setItem("hideCompletedTasks",S.hideCompleted?"1":"0");
  tasks();
}

async function tasks(){
 let rows=await api(`/api/tasks/${S.projectId}?sort=${S.sort}`);
 let visibleRows=S.hideCompleted?rows.filter(x=>x.status!=="已完成"):rows;
 let completedCount=rows.filter(x=>x.status==="已完成").length;
 let treeRows=hierarchyRows(visibleRows);
 $("#content").innerHTML=`<div class="actions"><button class="primary" onclick="taskDialog()">+ 新增</button><button onclick="taskDialog(true)">编辑选中</button><button class="danger" onclick="del('task')">删除选中</button><button onclick="toggleCompletedTasks()">${S.hideCompleted?`显示已完成 (${completedCount})`:`收纳已完成 (${completedCount})`}</button><span class="spacer"></span><label>任务排序</label><select style="width:auto" onchange="S.sort=this.value;tasks()"><option value="status" ${S.sort==="status"?"selected":""}>按状态</option><option value="priority" ${S.sort==="priority"?"selected":""}>按优先级</option><option value="version" ${S.sort==="version"?"selected":""}>按软件版本</option></select></div>
 <div class="card"><table><thead><tr><th>ID</th><th>任务</th><th>软件版本</th><th>状态</th><th>优先级</th><th>开始</th><th>截止</th></tr></thead><tbody>${treeRows.map(x=>`<tr ${taskRowEvents(x.id)}>${td(taskId(x.display_id),"center")}${td(taskTitleTreeHtml(x))}${td(vers(x.versions),"center")}${td(badge(x.status),"center")}${td(esc(x.priority),"center")}${td(esc(x.start_date),"center")}${td(esc(x.due_date),"center")}</tr>`).join("")}</tbody></table></div>`;
}

async function issues(){
 let rows=await api(`/api/issues/${S.projectId}`);
 $("#content").innerHTML=`<div class="actions"><button class="primary" onclick="issueDialog()">+ 新增</button><button onclick="issueDialog(true)">编辑选中</button><button class="danger" onclick="del('issue')">删除选中</button></div>
 <div class="card"><table><thead><tr><th>ID</th><th>Issue</th><th>类型</th><th>严重度</th><th>软件版本</th><th>状态</th><th>负责人</th><th>创建时间</th></tr></thead><tbody>${rows.map(x=>`<tr ${issueRowEvents(x.id)}>${td(issueId(x.display_id),"center")}${td(esc(x.title))}${td(esc(x.issue_type),"center")}${td(esc(x.severity),"center")}${td(vers(x.versions),"center")}${td(badge(x.status,"issue"),"center")}${td(esc(x.assignee),"center")}${td(esc(x.created_at),"center")}</tr>`).join("")}</tbody></table></div>`;
}
async function tests(){
 let rows=await api(`/api/tests/${S.projectId}`);
 $("#content").innerHTML=`<div class="actions"><button class="primary" onclick="testDialog()">+ 新增</button><button onclick="testDialog(true)">编辑选中</button><button class="danger" onclick="del('test')">删除选中</button></div>
 <div class="card"><table><thead><tr><th>ID</th><th>测试</th><th>类型</th><th>环境</th><th>软件版本</th><th>状态</th><th>测试人</th><th>时间</th></tr></thead><tbody>${rows.map(x=>`<tr ${testRowEvents(x.id)}>${td(x.display_id,"center")}${td(esc(x.name))}${td(esc(x.category),"center")}${td(esc(x.environment))}${td(vers(x.versions),"center")}${td(esc(x.status),"center")}${td(esc(x.tester),"center")}${td(esc(x.executed_at),"center")}</tr>`).join("")}</tbody></table></div>`;
}
async function versions(){
 let rows=await api(`/api/versions/${S.projectId}`);
 $("#content").innerHTML=`<div class="actions"><button class="primary" onclick="versionDialog()">+ 新增</button><button onclick="versionDialog(true)">编辑选中</button><button class="danger" onclick="del('version')">删除选中</button></div>
 <div class="card version-card"><table class="version-table"><thead><tr><th>ID</th><th>Version</th><th>备注</th><th>记录时间</th></tr></thead><tbody>${rows.map(x=>{
   const hasNote=String(x.notes||"").trim().length>0;
   const preview=notePreview(x.notes);
   return `<tr ${versionRowEvents(x.id)}>
     ${td(x.display_id,"center")}
     ${td(esc(x.version),"center")}
     <td class="version-note-cell">
       <div class="version-note-summary">
         <span class="version-note-preview ${hasNote?"":"muted"}">${esc(preview)}</span>
         ${hasNote?`<button type="button" class="note-toggle" data-version-note-btn="${x.id}" onclick="event.stopPropagation();toggleVersionNote(${x.id})" ondblclick="event.stopPropagation()">展开</button>`:""}
       </div>
     </td>
     ${td(esc(x.recorded_at),"center")}
   </tr>
   <tr id="version-note-${x.id}" class="version-note-detail hidden">
     <td colspan="4">
       <div class="version-note-detail-inner">
         <div class="markdown-body">${renderMarkdown(x.notes)}</div>
         <button type="button" class="note-collapse" onclick="toggleVersionNote(${x.id})">收起备注</button>
       </div>
     </td>
   </tr>`;
 }).join("")}</tbody></table></div>`;
}
async function logs(){
 let d=await api(`/api/logs/${S.projectId}`);
 $("#content").innerHTML=`<div class="grid2"><div class="card"><div class="actions"><h3>研发日志</h3><span class="spacer"></span><button class="primary" onclick="devlogDialog()">+ 新增</button></div><table><thead><tr><th>日期</th><th>摘要</th><th>阻塞</th><th>下一步</th></tr></thead><tbody>${d.dev_logs.map(x=>`<tr ondblclick="devlogDialog(true,${x.id})">${td(esc(x.log_date),"center")}${td(esc(x.summary))}${td(esc(x.blockers))}${td(esc(x.next_steps))}</tr>`).join("")}</tbody></table></div>
 <div class="card"><div class="actions"><h3>Git 记录</h3><span class="spacer"></span><button class="primary" onclick="gitDialog()">+ 新增</button></div><table><thead><tr><th>仓库</th><th>Branch</th><th>Commit</th><th>说明</th></tr></thead><tbody>${d.git_refs.map(x=>`<tr ondblclick="gitDialog(true,${x.id})">${td(esc(x.repo))}${td(esc(x.branch),"center")}${td(esc(x.commit_hash))}${td(esc(x.message))}</tr>`).join("")}</tbody></table></div></div>
 <div class="card" style="margin-top:14px"><div class="actions"><h3>ROS bag / Log</h3><span class="spacer"></span><button class="primary" onclick="rosDialog()">+ 新增</button></div><table><thead><tr><th>类型</th><th>机器人</th><th>路径</th><th>说明</th><th>时间</th></tr></thead><tbody>${d.ros_artifacts.map(x=>`<tr ondblclick="rosDialog(true,${x.id})">${td(esc(x.artifact_type),"center")}${td(esc(x.robot_name),"center")}${td(esc(x.path))}${td(esc(x.description))}${td(esc(x.recorded_at),"center")}</tr>`).join("")}</tbody></table></div>`;
}
async function gantt(){
 let rows=(await api(`/api/tasks/${S.projectId}?sort=status`)).filter(x=>x.start_date&&x.due_date);
 if(!rows.length){$("#content").innerHTML='<div class="card">暂无可显示的任务日期。</div>';return}
 let dates=rows.flatMap(x=>[new Date(x.start_date),new Date(x.due_date)]),min=new Date(Math.min(...dates)),max=new Date(Math.max(...dates)),span=Math.max(1,(max-min)/86400000+1);
 $("#content").innerHTML=`<div class="card"><h3>甘特图</h3>${rows.map(x=>{let s=(new Date(x.start_date)-min)/86400000,e=(new Date(x.due_date)-new Date(x.start_date))/86400000+1;return `<div class="gantt-row"><div class="center">${x.display_id}</div><div>${esc(x.title)}</div><div class="gantt-track"><div class="gantt-bar" style="left:${s/span*100}%;width:${e/span*100}%"></div></div></div>`}).join("")}</div>`;
}
function reports(){$("#content").innerHTML='<div class="card"><h3>项目报告</h3><p class="muted">生成当前项目的 Markdown 报告。</p><button class="primary" onclick="downloadReport()">生成 / 下载 Markdown</button></div>'}
async function downloadReport(){let r=await fetch(`/api/report/${S.projectId}`),t=await r.text(),b=new Blob([t],{type:"text/markdown;charset=utf-8"}),a=document.createElement("a");a.href=URL.createObjectURL(b);a.download="project_report.md";a.click()}

function showModal(t,b){$("#modalTitle").textContent=t;$("#modalBody").innerHTML=b;$("#modal").classList.remove("hidden")}function closeModal(){$("#modal").classList.add("hidden")}
function f(label,name,value="",type="text",wide=false){return `<div class="${wide?"wide":""}"><label>${label}</label><input id="f_${name}" type="${type}" value="${esc(value)}"></div>`}
function ta(label,name,value=""){return `<div class="wide"><label>${label}</label><textarea id="f_${name}">${esc(value)}</textarea></div>`}
function sf(label,name,opts,value=""){return `<div><label>${label}</label><select id="f_${name}">${opts.map(o=>`<option value="${esc(o)}" ${o===value?"selected":""}>${esc(o)}</option>`).join("")}</select></div>`}
function buttons(fn){return `<div class="actions" style="justify-content:flex-end;margin-top:14px"><button onclick="closeModal()">取消</button><button class="primary" onclick="${fn}">保存</button></div>`}
async function versionChecks(selected=[]){let rows=await api(`/api/versions/${S.projectId}`);return `<div class="wide"><label>软件版本</label><div class="multi">${rows.map(x=>`<label><input style="width:auto" type="checkbox" name="version_id" value="${x.id}" ${selected.includes(x.id)?"checked":""}> ${esc(x.version)}</label>`).join("")||'<span class="muted">请先创建软件版本</span>'}</div></div>`}
function vals(){let o={};document.querySelectorAll("#modalBody [id^=f_]").forEach(e=>o[e.id.slice(2)]=e.value);o.version_ids=[...document.querySelectorAll('#modalBody input[name=version_id]:checked')].map(x=>Number(x.value));return o}

function openProjectDialog(){showModal("新建项目",`<div class="form-grid">${f("名称","name")}${f("负责人","owner")}${f("开始日期","start_date",new Date().toISOString().slice(0,10),"date")}${f("目标日期","target_date","","date")}${ta("描述","description")}</div>${buttons("saveProject(false)")}`)}
function editProject(){let p=S.projects.find(x=>x.id===S.projectId);if(!p)return;showModal("编辑项目",`<div class="form-grid">${f("名称","name",p.name)}${f("负责人","owner",p.owner)}${f("开始日期","start_date",p.start_date,"date")}${f("目标日期","target_date",p.target_date,"date")}${ta("描述","description",p.description)}</div>${buttons("saveProject(true)")}`)}
async function saveProject(edit){await api(edit?`/api/projects/${S.projectId}`:"/api/projects",{method:edit?"PUT":"POST",body:JSON.stringify(vals())});closeModal();await loadProjects();if(edit)selectProject(S.projectId)}
async function deleteProject(){if(!S.projectId||!confirm("确定删除当前项目？"))return;await api(`/api/projects/${S.projectId}`,{method:"DELETE"});S.projectId=null;await loadProjects();render()}

async function taskDialog(edit=false){
 let rows=await api(`/api/tasks/${S.projectId}?sort=status`);
 let x=edit?rows.find(r=>r.id===S.selected):null;
 if(edit&&!x)return alert("请先选择任务");
 let av=await api(`/api/versions/${S.projectId}`);
 let ids=x?av.filter(v=>(x.versions||[]).includes(v.version)).map(v=>v.id):[];
 let parentField=`<div><label>父任务</label><select id="f_parent_id">${taskParentOptions(rows,x)}</select></div>`;
 showModal(edit?"编辑任务":"新增任务",`<div class="form-grid">${f("任务标题","title",x?.title||"")}${parentField}${sf("状态","status",["待办","进行中","阻塞","已完成"],x?.status||"待办")}${sf("优先级","priority",["低","中","高","紧急"],x?.priority||"中")}${f("开始","start_date",x?.start_date||new Date().toISOString().slice(0,10),"date")}${f("截止","due_date",x?.due_date||new Date().toISOString().slice(0,10),"date")}${ta("描述","description",x?.description||"")}${await versionChecks(ids)}</div>${buttons(`saveTask(${edit})`)}`)
}
async function saveTask(edit){
 let v=vals();
 v.parent_id=v.parent_id?Number(v.parent_id):null;
 try{
   await api(edit?`/api/tasks/item/${S.selected}`:`/api/tasks/${S.projectId}`,{method:edit?"PUT":"POST",body:JSON.stringify(v)});
   closeModal();
   S.selected=null;
   tasks();
 }catch(e){
   alert("保存任务失败："+e.message);
 }
}

async function issueDialog(edit=false){let rows=await api(`/api/issues/${S.projectId}`),x=edit?rows.find(r=>r.id===S.selected):null;if(edit&&!x)return alert("请先选择 Issue");let av=await api(`/api/versions/${S.projectId}`),ids=x?av.filter(v=>(x.versions||[]).includes(v.version)).map(v=>v.id):[];showModal(edit?"编辑 Issue":"新增 Issue",`<div class="form-grid">${f("标题","title",x?.title||"")}${sf("类型","issue_type",["Bug","需求","优化","集成问题","硬件问题","算法问题","仿真问题","通信问题","其他"],x?.issue_type||"Bug")}${sf("严重度","severity",["低","中","高","紧急"],x?.severity||"中")}${sf("状态","status",["Open","In Progress","Blocked","Resolved","Closed"],x?.status||"Open")}${f("负责人","assignee",x?.assignee||"")}${ta("问题描述","description",x?.description||"")}${ta("根因分析","root_cause",x?.root_cause||"")}${ta("解决方案","solution",x?.solution||"")}${await versionChecks(ids)}</div>${buttons(`saveIssue(${edit})`)}`)}
async function saveIssue(edit){await api(edit?`/api/issues/item/${S.selected}`:`/api/issues/${S.projectId}`,{method:edit?"PUT":"POST",body:JSON.stringify(vals())});closeModal();S.selected=null;issues()}

async function testDialog(edit=false){let rows=await api(`/api/tests/${S.projectId}`),x=edit?rows.find(r=>r.id===S.selected):null;if(edit&&!x)return alert("请先选择测试");let av=await api(`/api/versions/${S.projectId}`),ids=x?av.filter(v=>(x.versions||[]).includes(v.version)).map(v=>v.id):[];showModal(edit?"编辑测试":"新增测试",`<div class="form-grid">${f("测试名称","name",x?.name||"")}${f("测试类型","category",x?.category||"集成测试")}${f("测试环境","environment",x?.environment||"")}${sf("状态","status",["未执行","通过","失败","阻塞"],x?.status||"未执行")}${f("测试人","tester",x?.tester||"")}${ta("测试步骤","steps",x?.steps||"")}${ta("预期结果","expected",x?.expected||"")}${ta("实际结果","actual",x?.actual||"")}${ta("备注","notes",x?.notes||"")}${await versionChecks(ids)}</div>${buttons(`saveTest(${edit})`)}`)}
async function saveTest(edit){await api(edit?`/api/tests/item/${S.selected}`:`/api/tests/${S.projectId}`,{method:edit?"PUT":"POST",body:JSON.stringify(vals())});closeModal();S.selected=null;tests()}

async function versionDialog(edit=false){let rows=await api(`/api/versions/${S.projectId}`),x=edit?rows.find(r=>r.id===S.selected):null;if(edit&&!x)return alert("请先选择软件版本");showModal(edit?"编辑软件版本":"新增软件版本",`<div class="form-grid">${f("Version","version",x?.version||"")}${ta("备注（支持 Markdown）","notes",x?.notes||"")}<div class="wide markdown-hint">支持段落、换行、<strong>粗体</strong>、<em>斜体</em>、<code>行内代码</code>、代码块、列表和链接。表格中备注默认折叠，可按需展开。</div></div>${buttons(`saveVersion(${edit})`)}`)}
async function saveVersion(edit){await api(edit?`/api/versions/item/${S.selected}`:`/api/versions/${S.projectId}`,{method:edit?"PUT":"POST",body:JSON.stringify(vals())});closeModal();S.selected=null;versions()}

async function devlogDialog(edit=false,id=null){
 let x=null;if(edit){let d=await api(`/api/logs/${S.projectId}`);x=d.dev_logs.find(r=>r.id===id);if(!x)return alert("研发日志不存在")}
 showModal(edit?"编辑研发日志":"新增研发日志",`<div class="form-grid">${f("日期","log_date",x?.log_date||new Date().toISOString().slice(0,10),"date")}${f("记录人","author",x?.author||"")}${f("摘要","summary",x?.summary||"", "text",true)}${ta("详细内容","details",x?.details||"")}${ta("阻塞","blockers",x?.blockers||"")}${ta("下一步","next_steps",x?.next_steps||"")}</div>${buttons(`saveDevlog(${edit},${id||"null"})`)}`)}
async function saveDevlog(edit,id){await api(edit?`/api/devlogs/item/${id}`:`/api/devlogs/${S.projectId}`,{method:edit?"PUT":"POST",body:JSON.stringify(vals())});closeModal();logs()}
async function gitDialog(edit=false,id=null){
 let x=null;if(edit){let d=await api(`/api/logs/${S.projectId}`);x=d.git_refs.find(r=>r.id===id);if(!x)return alert("Git 记录不存在")}
 showModal(edit?"编辑 Git 记录":"新增 Git 记录",`<div class="form-grid">${f("仓库","repo",x?.repo||"")}${f("Branch","branch",x?.branch||"")}${f("Commit Hash","commit_hash",x?.commit_hash||"")}${f("作者","author",x?.author||"")}${ta("说明","message",x?.message||"")}</div>${buttons(`saveGit(${edit},${id||"null"})`)}`)}
async function saveGit(edit,id){await api(edit?`/api/git/item/${id}`:`/api/git/${S.projectId}`,{method:edit?"PUT":"POST",body:JSON.stringify(vals())});closeModal();logs()}
async function rosDialog(edit=false,id=null){
 let x=null;if(edit){let d=await api(`/api/logs/${S.projectId}`);x=d.ros_artifacts.find(r=>r.id===id);if(!x)return alert("ROS 记录不存在")}
 showModal(edit?"编辑 ROS 记录":"新增 ROS 记录",`<div class="form-grid">${f("类型","artifact_type",x?.artifact_type||"")}${f("机器人 / 平台","robot_name",x?.robot_name||"")}${f("路径","path",x?.path||"", "text",true)}${ta("说明","description",x?.description||"")}</div>${buttons(`saveRos(${edit},${id||"null"})`)}`)}
async function saveRos(edit,id){await api(edit?`/api/ros/item/${id}`:`/api/ros/${S.projectId}`,{method:edit?"PUT":"POST",body:JSON.stringify(vals())});closeModal();logs()}

async function del(kind){
 if(!S.selected)return alert("请先选择一条记录");if(!confirm("确定删除？"))return;
 let u=kind==="task"?`/api/tasks/item/${S.selected}`:kind==="issue"?`/api/issues/item/${S.selected}`:kind==="test"?`/api/tests/item/${S.selected}`:`/api/versions/item/${S.selected}`;
 await api(u,{method:"DELETE"});S.selected=null;render()
}
loadProjects();
