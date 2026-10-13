// projectmanager 3.21.0 — versions
// Classic script: shared globals preserve existing HTML event handlers.
function toggleVersionNote(id){
  const row=document.getElementById(`version-note-${id}`);
  const btn=document.querySelector(`[data-version-note-btn="${id}"]`);
  if(!row) return;
  const hidden=row.classList.toggle("hidden");
  if(btn) btn.textContent=hidden?"展开":"收起";
}

async function versions(){
 let rows=await api(`/api/versions/${S.projectId}`);
 $("#content").innerHTML=`<div class="actions"><button class="primary" onclick="versionDialog()">+ 新增</button><button data-edit-selected="version">编辑选中</button><button class="danger" onclick="del('version')">删除选中</button></div>
 <div class="card version-card"><table class="version-table"><thead><tr><th>ID</th><th>Version</th><th>Branch</th><th>备注</th><th>记录时间</th></tr></thead><tbody>${rows.map(x=>{
   const hasNote=String(x.notes||"").trim().length>0;
   const preview=notePreview(x.notes);
   return `<tr ${versionRowEvents(x.id)}>
     ${td(x.display_id,"center")}
     ${td(esc(x.version),"center")}
     ${td(esc(x.branch||""),"center")}
     <td class="version-note-cell"><div class="version-note-summary"><span class="version-note-preview ${hasNote?"":"muted"}">${esc(preview)}</span>${hasNote?`<button type="button" class="note-toggle" data-version-note-btn="${x.id}" onpointerdown="selectRowControl(event,${x.id},'version')" onclick="event.stopPropagation();toggleVersionNote(${x.id})" ondblclick="event.stopPropagation()">展开</button>`:""}</div></td>
     ${td(esc(displayDateTime(x.recorded_at)),"center")}
   </tr>
   <tr id="version-note-${x.id}" class="version-note-detail hidden"><td colspan="5"><div class="version-note-detail-inner"><div class="markdown-body">${renderMarkdown(x.notes)}</div><button type="button" class="note-collapse" onclick="toggleVersionNote(${x.id})">收起备注</button></div></td></tr>`;
 }).join("")}</tbody></table></div>`;
}

async function versionChecks(selected=[]){let rows=await api(`/api/versions/${S.projectId}`);return `<div class="wide"><label>软件版本</label><div class="multi">${rows.map(x=>`<label><input style="width:auto" type="checkbox" name="version_id" value="${x.id}" ${selected.includes(x.id)?"checked":""}> ${esc(x.version)}</label>`).join("")||'<span class="muted">请先创建软件版本</span>'}</div></div>`}

async function versionSelect(selectedId=""){
 let rows=await api(`/api/versions/${S.projectId}`);
 return `<div class="wide"><label>软件版本</label><select id="f_version_id">${['<option value="">未选择</option>'].concat(rows.map(x=>`<option value="${x.id}" ${String(x.id)===String(selectedId)?"selected":""}>${esc(x.version)}</option>`)).join("")}</select></div>`
}

async function versionDialog(edit=false,editId=null){let rows=await api(`/api/versions/${S.projectId}`);const targetId=edit?Number(editId ?? selectedIdFor("version")):null;if(edit && Number.isFinite(targetId)){S.selected=targetId;S.selectedKind="version";}let x=edit?rows.find(r=>Number(r.id)===targetId):null;if(edit&&!x)return alert("请先选择软件版本");showModal(edit?"编辑软件版本":"新增软件版本",`<div class="form-grid">${f("Version","version",x?.version||"")}${f("Branch","branch",x?.branch||"")}${ta("备注（支持 Markdown）","notes",x?.notes||"")}<div class="wide markdown-hint">支持段落、换行、<strong>粗体</strong>、<em>斜体</em>、<code>行内代码</code>、代码块、列表和链接。表格中备注默认折叠，可按需展开。</div></div>${buttons(`saveVersion(${edit})`)}`)}

async function saveVersion(edit){await api(edit?`/api/versions/item/${S.selected}`:`/api/versions/${S.projectId}`,{method:edit?"PUT":"POST",body:JSON.stringify(vals())});closeModal();S.selected=null;S.selectedKind=null;versions()}

async function versionMultiSelect(selected=[],defaultLatest=false){
 const rows=await api(`/api/versions/${S.projectId}`);
 if(defaultLatest&&rows.length)selected=[Math.max(...rows.map(row=>Number(row.id)))];
 return `<div class="wide"><label>软件版本（可多选，最新记录在上方）</label><details class="multi-select"><summary>已选择 ${selected.length} 项 · 点击展开</summary><div class="multi-options">${rows.sort((a,b)=>b.id-a.id).map(row=>`<label><input type="checkbox" name="version_id" value="${row.id}" ${selected.includes(row.id)?'checked':''} onchange="refreshMultiSelect(this)"><span>${esc(row.version)}</span></label>`).join('')||'<span class="muted">请先创建软件版本</span>'}</div></details></div>`;
}
