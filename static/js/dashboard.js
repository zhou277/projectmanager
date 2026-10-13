// Shared project dashboard and single-user portfolio dashboard.
function dashboardMetrics(data,personal=false){
 return `<div class="metrics dashboard-metrics">${personal?metric("项目总数",data.project_count):""}${metric("任务进度",`${data.task_done} / ${data.task_total} · ${data.progress}%`)}${metric("进行中任务",data.in_progress)}${metric("已延期任务",data.overdue_count)}${metric("7 天内截止",data.due_soon_count)}${metric("等待前置任务",data.dependency_blocked_count)}${metric("依赖风险任务",data.dependency_risk_count)}${metric("本周完成",data.completed_this_week)}${metric("高风险 Issue",data.high_risk_issues)}${metric("测试通过率",data.test_pass_rate==null?"暂无已执行测试":data.test_pass_rate+"%")}</div>`;
}

function dashboardTaskTable(rows,personal=false){
 if(!rows?.length)return '<div class="muted dashboard-empty">暂无任务</div>';
 return `<table><thead><tr>${personal?"<th>项目</th>":""}<th>任务</th><th>状态</th><th>优先级</th><th>截止日期</th><th>前置任务</th></tr></thead><tbody>${rows.map(task=>`<tr>${personal?td(esc(task.project_name)):""}${td(`<button class="dashboard-link" onclick="openDashboardTask(${task.project_id},${task.id})">${taskId(task.display_id)} · ${esc(task.title)}</button>`)}${td(badge(task.status),"center")}${td(esc(task.priority),"center")}${td(esc(task.due_date),"center")}${td(dependencySummary(task))}</tr>`).join("")}</tbody></table>`;
}

function dashboardStatusChart(data){
 const distribution=data.status_distribution||{};
 const colors=['#7779d4','#45a7ce','#e8aa49','#56aa78'];
 const entries=Object.entries(distribution).map(([status,value],index)=>({status,count:Number.isFinite(Number(value))?Math.max(0,Math.floor(Number(value))):0,color:colors[index%colors.length]}));
 const total=entries.reduce((sum,item)=>sum+item.count,0);
 let angle=-Math.PI/2;
 const slices=entries.filter(item=>item.count>0).map(item=>{
   const next=angle+item.count/total*Math.PI*2;
   const point=a=>`${(100+85*Math.cos(a)).toFixed(3)} ${(100+85*Math.sin(a)).toFixed(3)}`;
   const label=`${item.status}：${item.count} 项，占 ${(item.count/total*100).toFixed(1)}%`;
   const shape=item.count===total?`<circle cx="100" cy="100" r="85"`:`<path d="M 100 100 L ${point(angle)} A 85 85 0 ${next-angle>Math.PI?1:0} 1 ${point(next)} Z"`;
   angle=next;
   return `${shape} class="dashboard-pie-slice" fill="${item.color}" tabindex="0" role="img" aria-label="${esc(label)}"><title>${esc(label)}</title>${item.count===total?'</circle>':'</path>'}`;
 }).join('');
 return `<div class="card"><h3>任务状态分布</h3><div class="dashboard-pie-layout"><svg class="dashboard-pie" viewBox="0 0 200 200" role="group" aria-label="任务状态饼图，共 ${total} 项"><title>任务状态饼图</title>${total?slices:'<circle cx="100" cy="100" r="85" class="dashboard-pie-empty"/><text x="100" y="105" text-anchor="middle" class="dashboard-pie-empty-label">暂无任务</text>'}</svg><ul class="dashboard-pie-legend">${entries.map(item=>`<li><span class="dashboard-pie-key" style="background:${item.color}"></span><span>${esc(item.status)}</span><strong>${item.count}</strong><span class="muted">${total?(item.count/total*100).toFixed(1):'0.0'}%</span></li>`).join('')}<li class="dashboard-pie-total">任务总数 <strong>${total}</strong></li></ul></div></div>`;
}

function dashboardProjectTable(projects){
 if(!projects?.length)return '<div class="muted dashboard-empty">还没有项目，点击“新建项目”开始。</div>';
 return `<table><thead><tr><th>项目</th><th>完成进度</th><th>进行中</th><th>延期</th><th>依赖风险</th><th>高风险 Issue</th><th>最新记录版本</th></tr></thead><tbody>${projects.map(project=>`<tr>${td(`<button class="dashboard-link" onclick="openDashboardProject(${project.id})">${esc(project.name)}</button><div class="muted">${esc(project.owner||"未设置负责人")}</div>`)}${td(`<div class="dashboard-progress"><div style="width:${project.progress}%"></div></div><span>${project.task_done} / ${project.task_total} · ${project.progress}%</span>`,"center")}${td(project.in_progress,"center")}${td(project.overdue_count,"center")}${td(project.dependency_risk_count,"center")}${td(project.high_risk_issues,"center")}${td(esc(project.latest_version?.version||"—"),"center")}</tr>`).join("")}</tbody></table>`;
}

function dashboardHtml(data,personal=false){
 return `<div class="actions dashboard-heading"><div><h3>${personal?"个人 Dashboard · 全部项目":"项目 Dashboard"}</h3><div class="muted">${esc(data.today)} · UTC+8 · 截止日期过期且未完成计为延期</div></div><span class="spacer"></span><button onclick="render()">刷新</button></div>
 ${dashboardMetrics(data,personal)}
 ${personal?`<div class="card dashboard-section"><h3>各项目概览</h3>${dashboardProjectTable(data.projects)}</div>`:`<div class="card dashboard-section"><h3>项目信息</h3><span>最新记录软件版本：${esc(data.latest_version?.version||"暂无版本")}</span><span class="dashboard-detail">未关闭 Issue：${data.open_issues}</span><span class="dashboard-detail">测试通过 / 失败：${data.tests_passed} / ${data.tests_failed}</span></div>`}
 <div class="dashboard-grid">${dashboardStatusChart(data)}<div class="card"><h3>可以开始的任务</h3>${dashboardTaskTable(data.ready_tasks,personal)}</div></div>
 <div class="card dashboard-section"><h3>已延期任务</h3>${dashboardTaskTable(data.overdue_tasks,personal)}</div>
 <div class="card dashboard-section"><h3>今天至 7 天后截止</h3>${dashboardTaskTable(data.due_soon_tasks,personal)}</div>
 <div class="card dashboard-section"><h3>依赖风险 · 前置延期或日期冲突</h3>${dashboardTaskTable(data.dependency_risk_tasks,personal)}</div>
 <div class="card dashboard-section"><h3>高风险 Issue</h3>${personal?dashboardIssueTable(data.risky_issues):issueMini(data.risky_issues||[])}</div>
 ${personal?"":`<div class="overview-task-stack dashboard-section"><div class="card"><h3>当前待做任务</h3>${taskMini(data.pending||[],true)}</div><div class="card"><h3>已完成任务</h3>${taskMini(data.completed||[],false)}</div></div>`}`;
}

function dashboardIssueTable(rows){
 if(!rows?.length)return '<div class="muted dashboard-empty">暂无高风险 Issue</div>';
 return `<table><thead><tr><th>项目</th><th>Issue</th><th>严重度</th><th>状态</th></tr></thead><tbody>${rows.map(issue=>`<tr>${td(esc(issue.project_name))}${td(`<button class="dashboard-link" onclick="openDashboardIssue(${issue.project_id},${issue.id})">${issueId(issue.display_id)} · ${esc(issue.title)}</button>`)}${td(esc(issue.severity),"center")}${td(badge(issue.status,"issue"),"center")}</tr>`).join("")}</tbody></table>`;
}

async function personalDashboard(){
 $("#projectTitle").textContent="个人 Dashboard";
 $("#projectMeta").textContent="当前用户的所有本地项目";
 try{
   const data=await api("/api/dashboard");
   if(S.tab==="personal")$("#content").innerHTML=dashboardHtml(data,true);
 }catch(error){
   if(S.tab==="personal")$("#content").innerHTML=`<div class="card">Dashboard 加载失败：${esc(error.message)} <button onclick="render()">重试</button></div>`;
 }
}

async function openDashboardProject(projectId){
 S.tab="overview";
 await selectProject(projectId);
}

async function openDashboardTask(projectId,taskId){
 try{S.tab="tasks";await selectProject(projectId);await taskDialog(true,taskId);}catch(error){alert("任务加载失败："+error.message);}
}

async function openDashboardIssue(projectId,issueId){
 try{S.tab="issues";await selectProject(projectId);await issueDialog(true,issueId);}catch(error){alert("Issue 加载失败："+error.message);}
}

function openPersonalDashboard(){
 if(!allowDailyLogNavigation())return;
 S.tab="personal";S.selected=null;S.selectedKind=null;return render();
}
