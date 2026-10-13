// projectmanager 3.21.0 — tests
// Classic script: shared globals preserve existing HTML event handlers.
async function tests(){
 let rows=await api(`/api/tests/${S.projectId}`);
 $("#content").innerHTML=`<div class="actions"><button class="primary" onclick="testDialog()">+ 新增</button><button data-edit-selected="test">编辑选中</button><button class="danger" onclick="del('test')">删除选中</button></div>
 <div class="card"><table><thead><tr><th>ID</th><th>测试</th><th>类型</th><th>环境</th><th>软件版本</th><th>状态</th><th>测试人</th><th>时间</th></tr></thead><tbody>${rows.map(x=>`<tr ${testRowEvents(x.id)}>${td(x.display_id,"center")}${td(esc(x.name))}${td(esc(x.category),"center")}${td(esc(x.environment))}${td(vers(x.versions),"center")}${td(esc(x.status),"center")}${td(esc(x.tester),"center")}${td(esc(displayDateTime(x.executed_at)),"center")}</tr>`).join("")}</tbody></table></div>`;
}

async function testDialog(edit=false,editId=null){let rows=await api(`/api/tests/${S.projectId}`);const targetId=edit?Number(editId ?? selectedIdFor("test")):null;if(edit && Number.isFinite(targetId)){S.selected=targetId;S.selectedKind="test";}let x=edit?rows.find(r=>Number(r.id)===targetId):null;if(edit&&!x)return alert("请先选择测试");let av=await api(`/api/versions/${S.projectId}`),ids=x?av.filter(v=>(x.versions||[]).includes(v.version)).map(v=>v.id):[];showModal(edit?"编辑测试":"新增测试",`<div class="form-grid">${f("测试名称","name",x?.name||"")}${f("测试类型","category",x?.category||"集成测试")}${f("测试环境","environment",x?.environment||"")}${sf("状态","status",["未执行","通过","失败","阻塞"],x?.status||"未执行")}${f("测试人","tester",x?.tester||"")}${ta("测试步骤","steps",x?.steps||"")}${ta("预期结果","expected",x?.expected||"")}${ta("实际结果","actual",x?.actual||"")}${ta("备注","notes",x?.notes||"")}${await versionMultiSelect(ids,!edit)}</div>${buttons(`saveTest(${edit})`)}`)}

async function saveTest(edit){await api(edit?`/api/tests/item/${S.selected}`:`/api/tests/${S.projectId}`,{method:edit?"PUT":"POST",body:JSON.stringify(vals())});closeModal();S.selected=null;S.selectedKind=null;tests()}
