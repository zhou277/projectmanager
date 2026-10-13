// projectmanager 3.21.0 — projects
// Classic script: shared globals preserve existing HTML event handlers.
async function loadProjects(){
 S.projects=await api("/api/projects");
 $("#projectList").innerHTML=S.projects.map(p=>`<div class="project-item ${p.id===S.projectId?"active":""}" onclick="selectProject(${p.id})">${esc(p.name)}</div>`).join("");
 if(S.scope==="projects"&&!S.projectId&&S.projects[0])await selectProject(S.projects[0].id);
}

async function selectProject(id){
 if(!allowDailyLogNavigation())return;
 if(!PROJECT_TABS.includes(S.tab))S.tab="overview";
 S.scope="projects";
 S.projectId=id;S.selected=null;S.selectedKind=null;let p=S.projects.find(x=>x.id===id);
 $("#projectTitle").textContent=p?.name||"";
 $("#projectMeta").textContent=[p?.owner,p?.start_date&&`开始 ${p.start_date}`,p?.target_date&&`目标 ${p.target_date}`].filter(Boolean).join(" · ");
 $("#projectList").innerHTML=S.projects.map(x=>`<div class="project-item ${x.id===id?"active":""}" onclick="selectProject(${x.id})">${esc(x.name)}</div>`).join("");
 return render();
}

function openProjectDialog(){showModal("新建项目",`<div class="form-grid">${f("名称","name")}${f("负责人","owner")}${f("开始日期","start_date",new Date().toISOString().slice(0,10),"date")}${f("目标日期","target_date","","date")}${ta("描述","description")}</div>${buttons("saveProject(false)")}`)}

function editProject(){let p=S.projects.find(x=>x.id===S.projectId);if(!p)return;showModal("编辑项目",`<div class="form-grid">${f("名称","name",p.name)}${f("负责人","owner",p.owner)}${f("开始日期","start_date",p.start_date,"date")}${f("目标日期","target_date",p.target_date,"date")}${ta("描述","description",p.description)}</div>${buttons("saveProject(true)")}`)}

async function saveProject(edit){await api(edit?`/api/projects/${S.projectId}`:"/api/projects",{method:edit?"PUT":"POST",body:JSON.stringify(vals())});closeModal();await loadProjects();if(edit)await selectProject(S.projectId);else await render()}

async function deleteProject(){if(!S.projectId||!confirm("确定删除当前项目？"))return;await api(`/api/projects/${S.projectId}`,{method:"DELETE"});S.projectId=null;await loadProjects();render()}
