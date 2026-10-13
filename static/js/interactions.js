// projectmanager 3.21.0 — interactions
// Classic script: shared globals preserve existing HTML event handlers.
function statusClass(s,type="task"){
  return type==="issue"
    ? (s==="Open"?"red":(["Closed","Resolved"].includes(s)?"green":s==="In Progress"?"yellow":s==="Blocked"?"orange":"blue"))
    : (s==="已完成"?"green":s==="进行中"?"yellow":s==="阻塞"?"orange":"blue");
}

function inlineStatusSelect(id,status,type="task"){
  const options=type==="issue"
    ? ["Open","In Progress","Blocked","Resolved","Closed"]
    : ["待办","进行中","阻塞","已完成"];
  return `<select class="inline-status-select ${statusClass(status,type)}" onpointerdown="selectRowControl(event,${id},'${type}')" onclick="event.stopPropagation()" ondblclick="event.stopPropagation()" onchange="inlineStatusChange(event,${id},'${type}')">${options.map(x=>`<option value="${esc(x)}" ${x===status?"selected":""}>${esc(x)}</option>`).join("")}</select>`;
}

async function inlineStatusChange(event,id,type){
  event.stopPropagation();
  const el=event.target;
  const next=el.value;
  el.disabled=true;
  try{
    await api(type==="issue"?`/api/issues/item/${id}/status`:`/api/tasks/item/${id}/status`,{
      method:"PATCH",
      body:JSON.stringify({status:next})
    });
    el.className=`inline-status-select ${statusClass(next,type)}`;
    if(type==="issue") await issues(); else await tasks();
  }catch(e){
    alert("状态更新失败："+e.message);
    if(type==="issue") await issues(); else await tasks();
  }
}

function priorityClass(priority){
  return priority==="紧急"?"red":priority==="高"?"orange":priority==="中"?"blue":"green";
}

function inlinePrioritySelect(id,priority){
  const options=["低","中","高","紧急"];
  return `<select class="inline-priority-select ${priorityClass(priority)}" onpointerdown="selectRowControl(event,${id},'task')" onclick="event.stopPropagation()" ondblclick="event.stopPropagation()" onchange="inlinePriorityChange(event,${id})">${options.map(x=>`<option value="${esc(x)}" ${x===priority?"selected":""}>${esc(x)}</option>`).join("")}</select>`;
}

async function inlinePriorityChange(event,id){
  event.stopPropagation();
  const el=event.target;
  const next=el.value;
  el.disabled=true;
  try{
    await api(`/api/tasks/item/${id}/priority`,{
      method:"PATCH",
      body:JSON.stringify({priority:next})
    });
    el.className=`inline-priority-select ${priorityClass(next)}`;
    await tasks();
  }catch(e){
    alert("优先级更新失败："+e.message);
    await tasks();
  }
}

function sel(id,el,kind=null){
 S.selected=Number(id);
 S.selectedKind=kind || el?.closest?.("tr")?.dataset?.rowKind || null;
 document.querySelectorAll(".row-selected").forEach(x=>x.classList.remove("row-selected"));
 const row=el?.closest?el.closest("tr"):el;
 if(row)row.classList.add("row-selected");
}

function selectedRowClass(id){return Number(S.selected)===Number(id)?"row-selected":""}

function selectedIdFor(kind){
 const row=document.querySelector(`tr.row-selected[data-row-kind="${kind}"]`);
 if(row?.dataset?.rowId)return Number(row.dataset.rowId);
 if(S.selectedKind===kind && S.selected!=null)return Number(S.selected);
 return null;
}

function editSelected(kind){
 const id=selectedIdFor(kind);
 if(id==null)return alert(kind==="task"?"请先选择任务":kind==="issue"?"请先选择 Issue":kind==="version"?"请先选择软件版本":"请先选择记录");
 if(kind==="task")return taskDialog(true,id);
 if(kind==="issue")return issueDialog(true,id);
 if(kind==="test")return testDialog(true,id);
 if(kind==="version")return versionDialog(true,id);
}

function editRow(kind,id,el){
 sel(id,el,kind);
 if(kind==="task")return taskDialog(true,id);
 if(kind==="issue")return issueDialog(true,id);
 if(kind==="test")return testDialog(true,id);
 if(kind==="version")return versionDialog(true,id);
}

function clickRow(id){return `class="${selectedRowClass(id)}" onclick="sel(${id},this)"`}

function taskRowEvents(id){return `class="${selectedRowClass(id)}" data-row-kind="task" data-row-id="${id}"`}

function issueRowEvents(id){return `class="${selectedRowClass(id)}" data-row-kind="issue" data-row-id="${id}"`}

function testRowEvents(id){return `class="${selectedRowClass(id)}" data-row-kind="test" data-row-id="${id}"`}

function versionRowEvents(id){return `class="${selectedRowClass(id)}" data-row-kind="version" data-row-id="${id}"`}

function selectRowControl(event,id,kind=null){
 const row=event?.target?.closest?.("tr");
 sel(id,row,kind || row?.dataset?.rowKind || null);
 event?.stopPropagation?.();
}

function isRowInteractiveTarget(target){
 return !!target?.closest?.("select,button,input,textarea,a,label");
}

function installContentInteractionHandlers(){
 const content=document.querySelector("#content");
 if(!content || content.dataset.editHandlersInstalled==="1")return;
 content.dataset.editHandlersInstalled="1";
 content.addEventListener("click",event=>{
   const editBtn=event.target.closest?.("[data-edit-selected]");
   if(editBtn){
     event.preventDefault();
     event.stopPropagation();
     editSelected(editBtn.dataset.editSelected);
     return;
   }
   const row=event.target.closest?.("tr[data-row-kind][data-row-id]");
   if(!row || isRowInteractiveTarget(event.target))return;
   sel(Number(row.dataset.rowId),row,row.dataset.rowKind);
 });
 content.addEventListener("dblclick",event=>{
   const row=event.target.closest?.("tr[data-row-kind][data-row-id]");
   if(!row || isRowInteractiveTarget(event.target))return;
   event.preventDefault();
   editRow(row.dataset.rowKind,Number(row.dataset.rowId),row);
 });
}
