// projectmanager 3.21.0 — logs
// Classic script: shared globals preserve existing HTML event handlers.
async function logs(){
 let items=await api(`/api/dev-overviews/${S.projectId}`);
 let d=await api(`/api/logs/${S.projectId}`);
 $("#content").innerHTML=`<div class="card"><div class="actions"><h3>研发总体事项</h3><span class="spacer"></span><button class="primary" onclick="devOverviewDialog()">+ 新增</button></div><div class="dev-overview-grid">${items.map(x=>`<article class="dev-overview-card" ondblclick="devOverviewDialog(true,${x.id})"><div class="dev-overview-head"><strong>${esc(x.title)}</strong><span class="muted">${esc(displayDateTime(x.updated_at))}</span></div><div class="markdown-body">${renderMarkdown(x.content||"")}</div></article>`).join("") || `<div class="muted">暂无研发总体事项，可按“目标 / Done / Working / TODO”格式记录。</div>`}</div></div>
 <div class="card" style="margin-top:14px"><div class="actions"><h3>ROS Topic</h3><span class="spacer"></span><button class="primary" onclick="rosDialog()">+ 新增</button></div><table><thead><tr><th>Topic名称</th><th>类型</th><th>说明</th><th>举例</th></tr></thead><tbody>${d.ros_artifacts.map(x=>`<tr ondblclick="rosDialog(true,${x.id})">${td(esc(x.path))}${td(esc(x.artifact_type),"center")}${td(esc(x.description))}${td(esc(x.robot_name))}</tr>`).join("")}</tbody></table></div>`;
}

async function devOverviewDialog(edit=false,id=null){
 let x=null;if(edit){let rows=await api(`/api/dev-overviews/${S.projectId}`);x=rows.find(r=>r.id===id);if(!x)return alert("研发事项不存在")}
 const template=`### 研发工作\n\n- 目标:\n\n- Done:\n\n- Working:\n  - \n\n- TODO:\n  - `;
 showModal(
   edit?"编辑研发总体事项":"新增研发总体事项",
   `<div class="form-grid dev-overview-editor">${f("标题","title",x?.title||"")}${ta("内容（Markdown）","content",x?.content||template)}</div>${buttons(`saveDevOverview(${edit},${id||"null"})`)}`,
   "large"
 )}

async function saveDevOverview(edit,id){await api(edit?`/api/dev-overviews/item/${id}`:`/api/dev-overviews/${S.projectId}`,{method:edit?"PUT":"POST",body:JSON.stringify(vals())});closeModal();logs()}

async function devlogDialog(edit=false,id=null){
 let x=null;if(edit){let d=await api(`/api/logs/${S.projectId}`);x=d.dev_logs.find(r=>r.id===id);if(!x)return alert("研发日志不存在")}
 showModal(edit?"编辑研发日志":"新增研发日志",`<div class="form-grid">${f("日期","log_date",x?.log_date||new Date().toISOString().slice(0,10),"date")}${f("记录人","author",x?.author||"")}${f("摘要","summary",x?.summary||"", "text",true)}${ta("详细内容","details",x?.details||"")}${ta("阻塞","blockers",x?.blockers||"")}${ta("下一步","next_steps",x?.next_steps||"")}</div>${buttons(`saveDevlog(${edit},${id||"null"})`)}`)}

async function saveDevlog(edit,id){await api(edit?`/api/devlogs/item/${id}`:`/api/devlogs/${S.projectId}`,{method:edit?"PUT":"POST",body:JSON.stringify(vals())});closeModal();logs()}

async function gitDialog(edit=false,id=null){
 let x=null;if(edit){let d=await api(`/api/logs/${S.projectId}`);x=d.git_refs.find(r=>r.id===id);if(!x)return alert("Git 记录不存在")}
 showModal(edit?"编辑 Git 记录":"新增 Git 记录",`<div class="form-grid">${f("仓库","repo",x?.repo||"")}${f("Branch","branch",x?.branch||"")}${f("Commit Hash","commit_hash",x?.commit_hash||"")}${f("作者","author",x?.author||"")}${ta("说明","message",x?.message||"")}</div>${buttons(`saveGit(${edit},${id||"null"})`)}`)}

async function saveGit(edit,id){await api(edit?`/api/git/item/${id}`:`/api/git/${S.projectId}`,{method:edit?"PUT":"POST",body:JSON.stringify(vals())});closeModal();logs()}

async function rosDialog(edit=false,id=null){
 let x=null;if(edit){let d=await api(`/api/logs/${S.projectId}`);x=d.ros_artifacts.find(r=>r.id===id);if(!x)return alert("ROS Topic 记录不存在")}
 showModal(edit?"编辑 ROS Topic":"新增 ROS Topic",`<div class="form-grid">${f("Topic名称","topic_name",x?.path||"")}${f("类型","message_type",x?.artifact_type||"")}${ta("说明","description",x?.description||"")}${ta("举例","example",x?.robot_name||"")}</div>${buttons(`saveRos(${edit},${id||"null"})`)}`)}

async function saveRos(edit,id){await api(edit?`/api/ros/item/${id}`:`/api/ros/${S.projectId}`,{method:edit?"PUT":"POST",body:JSON.stringify(vals())});closeModal();logs()}
