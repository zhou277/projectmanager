// projectmanager 3.21.0 — issues
// Classic script: shared globals preserve existing HTML event handlers.
async function issues(){
 let rows=await api(`/api/issues/${S.projectId}`);
 $("#content").innerHTML=`<div class="actions"><button class="primary" onclick="issueDialog()">+ 新增</button><button data-edit-selected="issue">编辑选中</button><button class="danger" onclick="del('issue')">删除选中</button></div>
 <div class="card"><table><thead><tr><th>ID</th><th>Issue</th><th>类型</th><th>严重度</th><th>软件版本</th><th>状态</th><th>关联测试</th><th>负责人</th><th>创建时间</th></tr></thead><tbody>${rows.map(x=>`<tr ${issueRowEvents(x.id)}>${td(issueId(x.display_id),"center")}${td(esc(x.title))}${td(esc(x.issue_type),"center")}${td(esc(x.severity),"center")}${td(vers(x.versions),"center")}${td(inlineStatusSelect(x.id,x.status,"issue"),"center")}${td(issueTestLinks(x))}${td(esc(x.assignee),"center")}${td(esc(displayDateTime(x.created_at)),"center")}</tr>`).join("")}</tbody></table></div>`;
}

async function issueDialog(edit=false,editId=null){let rows=await api(`/api/issues/${S.projectId}`);const targetId=edit?Number(editId ?? selectedIdFor("issue")):null;if(edit && Number.isFinite(targetId)){S.selected=targetId;S.selectedKind="issue";}let x=edit?rows.find(r=>Number(r.id)===targetId):null;if(edit&&!x)return alert("请先选择 Issue");let av=await api(`/api/versions/${S.projectId}`),ids=x?av.filter(v=>(x.versions||[]).includes(v.version)).map(v=>v.id):[];showModal(edit?"编辑 Issue":"新增 Issue",`<div class="form-grid">${f("标题","title",x?.title||"")}${sf("类型","issue_type",["Bug","需求","优化","集成问题","硬件问题","算法问题","仿真问题","通信问题","其他"],x?.issue_type||"Bug")}${sf("严重度","severity",["低","中","高","紧急"],x?.severity||"中")}${sf("状态","status",["Open","In Progress","Blocked","Resolved","Closed"],x?.status||"Open")}${f("负责人","assignee",x?.assignee||"")}${ta("问题描述","description",x?.description||"")}${ta("根因分析","root_cause",x?.root_cause||"")}${ta("解决方案","solution",x?.solution||"")}${await versionMultiSelect(ids,!edit)}${await issueTestChoices(x?.test_ids||[])}</div>${buttons(`saveIssue(${edit})`)}`)}

async function saveIssue(edit){
 const payload=vals();payload.test_ids=[...document.querySelectorAll('#modalBody input[name=test_id]:checked')].map(input=>Number(input.value));
 try{await api(edit?`/api/issues/item/${S.selected}`:`/api/issues/${S.projectId}`,{method:edit?'PUT':'POST',body:JSON.stringify(payload)});closeModal();S.selected=null;S.selectedKind=null;await issues();}
 catch(error){alert('Issue 保存失败：'+error.message);}
}

async function issueTestChoices(selected=[]){
 const rows=await api(`/api/tests/${S.projectId}`);
 return `<div class="wide"><label>关联测试（同项目，可多选）</label><details class="multi-select"><summary>已选择 ${selected.length} 项 · 点击展开</summary><div class="multi-options">${rows.sort((a,b)=>a.id-b.id).map(row=>`<label><input type="checkbox" name="test_id" value="${row.id}" ${selected.includes(row.id)?'checked':''} onchange="refreshMultiSelect(this)"><span>Test-${row.display_id} · ${esc(row.name)} · ${esc(row.status)}</span></label>`).join('')||'<span class="muted">请先在当前项目新增测试</span>'}</div></details></div>`;
}
function issueTestLinks(issue){return (issue.tests||[]).map(test=>`<button class="issue-test-link" onpointerdown="selectRowControl(event,${issue.id},'issue')" onclick="event.stopPropagation();openIssueTest(${issue.project_id},${test.id})" ondblclick="event.stopPropagation()" title="${esc(test.status)}">Test-${test.display_id} · ${esc(test.name)}</button>`).join('')||'<span class="muted">—</span>';}
async function openIssueTest(projectId,testId){try{S.tab='tests';await selectProject(projectId);await testDialog(true,testId);}catch(error){alert('测试加载失败：'+error.message);}}
