// projectmanager 3.21.0 — tasks
// Classic script: shared globals preserve existing HTML event handlers.
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
 $("#content").innerHTML=`<div class="actions"><button class="primary" onclick="taskDialog()">+ 新增</button><button data-edit-selected="task">编辑选中</button><button class="danger" onclick="del('task')">删除选中</button><button onclick="toggleCompletedTasks()">${S.hideCompleted?`显示已完成 (${completedCount})`:`收纳已完成 (${completedCount})`}</button><span class="spacer"></span><label>任务排序</label><select style="width:auto" onchange="S.sort=this.value;tasks()"><option value="status" ${S.sort==="status"?"selected":""}>按状态</option><option value="priority" ${S.sort==="priority"?"selected":""}>按优先级</option><option value="version" ${S.sort==="version"?"selected":""}>按软件版本</option></select></div>
 <div class="card"><table><thead><tr><th>ID</th><th>任务</th><th>软件版本</th><th>状态</th><th>优先级</th><th>前置任务 / 风险</th><th>开始</th><th>截止</th></tr></thead><tbody>${treeRows.map(x=>`<tr ${taskRowEvents(x.id)}>${td(taskId(x.display_id),"center")}${td(taskTitleTreeHtml(x))}${td(vers(x.versions),"center")}${td(inlineStatusSelect(x.id,x.status,"task"),"center")}${td(inlinePrioritySelect(x.id,x.priority),"center")}${td(dependencySummary(x))}${td(esc(x.start_date),"center")}${td(esc(x.due_date),"center")}</tr>`).join("")}</tbody></table></div>`;
}

async function taskDialog(edit=false,editId=null){
 let rows=await api(`/api/tasks/${S.projectId}?sort=status`);
 const targetId=edit?Number(editId ?? selectedIdFor("task")):null;
 if(edit && Number.isFinite(targetId)){S.selected=targetId;S.selectedKind="task";}
 let x=edit?rows.find(r=>Number(r.id)===targetId):null;
 if(edit&&!x)return alert("请先选择任务");
 let av=await api(`/api/versions/${S.projectId}`);
 let ids=x?av.filter(v=>(x.versions||[]).includes(v.version)).map(v=>v.id):[];
 const defaultDay=x?.start_date||nextTaskDate(rows);
 let parentField=`<div><label>父任务</label><select id="f_parent_id">${taskParentOptions(rows,x)}</select></div>`;
 let childCreateField=edit?`<div class="wide child-create-section"><label>子任务</label><div class="child-create-row"><span class="muted">直接创建一个新任务并自动挂到当前任务下面。</span><button type="button" class="primary" onclick="openChildTaskDialog(${x.id})">+ 新建子任务</button></div></div>`:"";
 showModal(edit?"编辑任务":"新增任务",`<div class="form-grid">${f("任务标题","title",x?.title||"")}${parentField}<div class="wide task-status-priority">${sf("状态","status",["待办","进行中","阻塞","已完成"],x?.status||"待办")}${sf("优先级","priority",["低","中","高","紧急"],x?.priority||"中")}</div>${f("开始","start_date",defaultDay,"date")}${f("截止","due_date",x?.due_date||defaultDay,"date")}${ta("描述","description",x?.description||"")}${await versionMultiSelect(ids,!edit)}${dependencyChoices(rows,x)}${childCreateField}</div>${buttons(`saveTask(${edit})`)}`);
 installTaskDatePreview(rows);
 if(!edit)$('#f_parent_id')?.addEventListener('change',()=>{const day=nextTaskDate(rows,Number($('#f_parent_id').value)||null);$('#f_start_date').value=day;$('#f_due_date').value=day;previewTaskDates();});
}

async function openChildTaskDialog(parentTaskId){
 let rows=await api(`/api/tasks/${S.projectId}?sort=status`);
 let parent=rows.find(r=>r.id===parentTaskId);
 if(!parent)return alert("父任务不存在");
 let today=nextTaskDate(rows,parentTaskId);
 showModal(
   `新建子任务 · ${taskId(parent.display_id)} ${parent.title}`,
   `<div class="form-grid child-task-create-form">
      ${f("任务标题","title","")}
      <div class="wide task-status-priority">${sf("状态","status",["待办","进行中","阻塞","已完成"],"待办")}${sf("优先级","priority",["低","中","高","紧急"],"中")}</div>
      <div class="wide task-date-pair">${f("开始","start_date",today,"date")}${f("截止","due_date",today,"date")}</div>
      ${ta("描述","description","")}
      ${await versionMultiSelect([],true)}
      ${dependencyChoices(rows,{parent_id:parentTaskId})}
    </div>
    <div class="actions" style="justify-content:flex-end;margin-top:14px">
      <button onclick="S.selected=${parentTaskId};taskDialog(true)">返回父任务</button>
      <button class="primary" onclick="saveChildTask(${parentTaskId})">创建子任务</button>
    </div>`,
   "large"
 );
 installTaskDatePreview(rows);
}

async function saveChildTask(parentTaskId){
 let v=vals();
 v.parent_id=parentTaskId;
 try{
   await api(`/api/tasks/${S.projectId}`,{method:"POST",body:JSON.stringify(v)});
   // Refresh the task hierarchy, then reopen the parent task editor.
   S.selected=parentTaskId;
   await tasks();
   S.selected=parentTaskId;
   await taskDialog(true);
 }catch(e){
   alert("创建子任务失败："+e.message);
 }
}

async function saveTask(edit){
 let v=vals();
 v.parent_id=v.parent_id?Number(v.parent_id):null;
 try{
   await api(edit?`/api/tasks/item/${S.selected}`:`/api/tasks/${S.projectId}`,{method:edit?"PUT":"POST",body:JSON.stringify(v)});
   closeModal();
   S.selected=null;S.selectedKind=null;
   tasks();
 }catch(e){
   alert("保存任务失败："+e.message);
 }
}
