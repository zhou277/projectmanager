// projectmanager 3.21.0 — core
// Classic script: shared globals preserve existing HTML event handlers.
let S={scope:"personal",projectId:null,projects:[],tab:"personal",selected:null,sort:"status",hideCompleted:localStorage.getItem("hideCompletedTasks")==="1",settings:null,selectedKind:null};

async function render(){
 syncNavigation();
 if(S.tab==="personal")return personalDashboard();
 if(S.tab==="daily")return dailyLogsPage();
 const project=S.projects.find(row=>row.id===S.projectId);
 $("#projectTitle").textContent=project?.name||"请选择项目";
 $("#projectMeta").textContent=[project?.owner,project?.start_date&&`开始 ${project.start_date}`,project?.target_date&&`目标 ${project.target_date}`].filter(Boolean).join(" · ");
 if(S.tab==="settings"){$("#projectTitle").textContent="设置";$("#projectMeta").textContent="应用设置与数据库备份";return settingsPage();}
 if(S.tab==="about"){$("#projectTitle").textContent="版本信息";$("#projectMeta").textContent="projectmanager";return aboutPage();}
 if(!S.projectId){$("#content").innerHTML='<div class="card">请从左侧选择或新建项目。</div>';return}
 if(S.tab==="overview")return overview();
 if(S.tab==="tasks")return tasks();
 if(S.tab==="issues")return issues();
 if(S.tab==="tests")return tests();
 if(S.tab==="versions")return versions();
 if(S.tab==="logs")return logs();
 if(S.tab==="gantt")return gantt();
}

async function del(kind){
 if(!S.selected)return alert("请先选择一条记录");if(!confirm("确定删除？"))return;
 let u=kind==="task"?`/api/tasks/item/${S.selected}`:kind==="issue"?`/api/issues/item/${S.selected}`:kind==="test"?`/api/tests/item/${S.selected}`:`/api/versions/item/${S.selected}`;
 await api(u,{method:"DELETE"});S.selected=null;render()
}

function verifyEditingInfrastructure(){
 const required=[
   ["showModal",typeof showModal],
   ["closeModal",typeof closeModal],
   ["f",typeof f],
   ["ta",typeof ta],
   ["sf",typeof sf],
   ["buttons",typeof buttons]
 ];
 const missing=required.filter(([,type])=>type!=="function").map(([name])=>name);
 if(missing.length){
   throw new Error("Editing infrastructure missing: "+missing.join(", "));
 }
}

async function initializeApp(){
 installContentInteractionHandlers();
 try{
   S.settings=await api("/api/settings");
   const localTheme=localStorage.getItem("theme");
   const theme=localTheme || S.settings.theme || "dark";
   document.body.classList.toggle("light",theme==="light");
 }catch(e){
   document.body.classList.toggle("light",localStorage.getItem("theme")==="light");
 }
 await loadProjects();
 await render();
}
