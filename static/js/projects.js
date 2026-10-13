// projectmanager 3.21.0 — projects
// Classic script: shared globals preserve existing HTML event handlers.
async function loadProjects(){
 S.projects=await api("/api/projects");
 renderProjectList();
 if(S.scope==="projects"&&!S.projectId&&S.projects[0])await selectProject(S.projects[0].id);
}

async function selectProject(id){
 if(!allowDailyLogNavigation())return;
 if(!PROJECT_TABS.includes(S.tab))S.tab="overview";
 S.scope="projects";
 S.projectId=id;S.selected=null;S.selectedKind=null;let p=S.projects.find(x=>x.id===id);
 $("#projectTitle").textContent=p?.name||"";
 $("#projectMeta").textContent=[p?.owner,p?.start_date&&`开始 ${p.start_date}`,p?.target_date&&`目标 ${p.target_date}`].filter(Boolean).join(" · ");
 renderProjectList();
 return render();
}

function openProjectDialog(){showModal("新建项目",`<div class="form-grid">${f("名称","name")}${f("负责人","owner")}${f("开始日期","start_date",new Date().toISOString().slice(0,10),"date")}${f("目标日期","target_date","","date")}${ta("描述","description")}</div>${buttons("saveProject(false)")}`)}

function editProject(){let p=S.projects.find(x=>x.id===S.projectId);if(!p)return;showModal("编辑项目",`<div class="form-grid">${f("名称","name",p.name)}${f("负责人","owner",p.owner)}${f("开始日期","start_date",p.start_date,"date")}${f("目标日期","target_date",p.target_date,"date")}${ta("描述","description",p.description)}</div>${buttons("saveProject(true)")}`)}

async function saveProject(edit){await api(edit?`/api/projects/${S.projectId}`:"/api/projects",{method:edit?"PUT":"POST",body:JSON.stringify(vals())});closeModal();await loadProjects();if(edit)await selectProject(S.projectId);else await render()}

async function deleteProject(){if(!S.projectId||!confirm("确定删除当前项目？"))return;await api(`/api/projects/${S.projectId}`,{method:"DELETE"});S.projectId=null;await loadProjects();render()}

let ProjectOrdering=false;
function renderProjectList(){
 $('#projectList').innerHTML=S.projects.map((project,index)=>`<div class="project-item ${project.id===S.projectId?'active':''}" data-project-id="${project.id}" draggable="${!ProjectOrdering}" ondragstart="projectDragStart(event,${project.id})" ondragover="event.preventDefault()" ondrop="projectDrop(event,${project.id})" onclick="selectProject(${project.id})"><span class="project-item-name">${esc(project.name)}</span><span class="project-order-tools"><button title="上移 ${esc(project.name)}" aria-label="上移 ${esc(project.name)}" ${!index||ProjectOrdering?'disabled':''} onclick="event.stopPropagation();moveProject(${project.id},-1)">↑</button><button title="下移 ${esc(project.name)}" aria-label="下移 ${esc(project.name)}" ${index===S.projects.length-1||ProjectOrdering?'disabled':''} onclick="event.stopPropagation();moveProject(${project.id},1)">↓</button></span></div>`).join('');
}
async function saveProjectOrder(ids){
 if(ProjectOrdering)return;
 ProjectOrdering=true;renderProjectList();
 try{await api('/api/projects/order',{method:'PUT',body:JSON.stringify({project_ids:ids})});await loadProjects();}
 catch(error){alert('项目排序未保存：'+error.message);try{await loadProjects();}catch(ignored){}}
 finally{ProjectOrdering=false;renderProjectList();}
}
function moveProject(id,delta){
 if(ProjectOrdering)return;
 const ids=S.projects.map(project=>project.id),index=ids.indexOf(id),target=index+delta;
 if(index<0||target<0||target>=ids.length)return;
 [ids[index],ids[target]]=[ids[target],ids[index]];return saveProjectOrder(ids);
}
function projectDragStart(event,id){if(ProjectOrdering){event.preventDefault();return;}event.dataTransfer.setData('application/x-projectmanager-project',String(id));event.dataTransfer.effectAllowed='move';}
function projectDrop(event,targetId){
 event.preventDefault();event.stopPropagation();if(ProjectOrdering)return;
 const id=Number(event.dataTransfer.getData('application/x-projectmanager-project'));
 const ids=S.projects.map(project=>project.id),from=ids.indexOf(id),to=ids.indexOf(targetId);
 if(from<0||to<0||from===to)return;
 ids.splice(from,1);ids.splice(to,0,id);return saveProjectOrder(ids);
}
