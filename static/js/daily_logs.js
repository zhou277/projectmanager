// Parallel daily writing, read-only project references, and preserved legacy snapshots.
const Daily={date:null,log:null,archive:{years:[]},available:{projects:[]},dirty:false,saving:false,loading:false,request:0,year:null,week:null};

function dailyToday(){return new Date(Date.now()+8*3600000).toISOString().slice(0,10);}
function dailyKey(item){return `${item.entity_kind}:${item.entity_id}`;}
function dailyMarkDirty(){Daily.dirty=true;const el=$("#dailySaveStatus");if(el)el.textContent="有未保存的修改";}
function allowDailyLogNavigation(){
 if(S.tab!=="daily")return true;
 if(Daily.saving||Daily.loading)return false;
 if(Daily.dirty&&!confirm("当日日志尚未保存，离开将放弃修改。确定离开吗？"))return false;
 Daily.dirty=false;return true;
}
function installDailyLogGuards(){window.addEventListener("beforeunload",event=>{if(Daily.dirty){event.preventDefault();event.returnValue="";}});}
function openDailyLogs(){if(S.tab==="daily")return;if(!allowDailyLogNavigation())return;S.tab="daily";S.selected=null;S.selectedKind=null;return render();}

async function dailyLogsPage(){
 $("#projectTitle").textContent="每日日志";$("#projectMeta").textContent="跨项目计划与工作记录 · 按工作年 / 工作周归档";
 return loadDailyLog(Daily.date||dailyToday());
}
async function loadDailyLog(day){
 if(Daily.saving||Daily.loading)return;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day))return alert("请选择有效日期");
 if(Daily.dirty&&!confirm("切换日期将放弃未保存的修改，是否继续？")){const input=$("#dailyDate");if(input)input.value=Daily.date;return;}
 const request=++Daily.request;
 Daily.loading=true;dailyDisableControls(true);
 try{
   const [log,archive,available]=await Promise.all([api(`/api/daily-logs/${day}`),api("/api/daily-logs/archive"),api("/api/daily-logs/available")]);
   if(request!==Daily.request||S.tab!=="daily")return;
   Daily.date=day;Daily.log=log;Daily.archive=archive;Daily.available=available;Daily.dirty=false;
   const work=dailyWorkWeek(day);Daily.year=work.year;Daily.week=work.week;renderDailyLog();
 }catch(error){if(S.tab==="daily"&&request===Daily.request){if(!Daily.log)$("#content").innerHTML=`<div class="card">日志加载失败：${esc(error.message)} <button onclick="dailyLogsPage()">重试</button></div>`;else alert("日志加载失败，当前内容已保留："+error.message);}}
 finally{Daily.loading=false;if(S.tab==="daily"&&Daily.log)renderDailyLog();}
}
function dailyShiftDay(delta){const date=new Date(Daily.date+"T00:00:00Z");date.setUTCDate(date.getUTCDate()+delta);return loadDailyLog(date.toISOString().slice(0,10));}

function dailyWorkWeek(value){
 const day=parseIsoDateUTC(value);if(!day)return null;
 const weekday=day.getUTCDay()||7;
 const monday=new Date(day);monday.setUTCDate(day.getUTCDate()-weekday+1);
 const thursday=new Date(monday);thursday.setUTCDate(monday.getUTCDate()+3);
 const year=thursday.getUTCFullYear();const firstThursday=new Date(0);firstThursday.setUTCFullYear(year,0,4);firstThursday.setUTCHours(0,0,0,0);
 const firstMonday=new Date(firstThursday);firstMonday.setUTCDate(firstThursday.getUTCDate()-(firstThursday.getUTCDay()||7)+1);
 const week=Math.round((monday-firstMonday)/(7*86400000))+1;
 const sunday=new Date(monday);sunday.setUTCDate(monday.getUTCDate()+6);
 return {year,week,weekday,start_date:monday.toISOString().slice(0,10),end_date:sunday.toISOString().slice(0,10)};
}
function dailyWorkYears(){
 if(Daily.archive.work_years)return Daily.archive.work_years;
 // Read older cached archive responses without depending on summary previews.
 const grouped=new Map();
 for(const year of Daily.archive.years||[])for(const month of year.months||[])for(const day of month.days||[]){
   const work=dailyWorkWeek(day.log_date);if(!work)continue;
   if(!grouped.has(work.year))grouped.set(work.year,new Map());
   const weeks=grouped.get(work.year);if(!weeks.has(work.week))weeks.set(work.week,{...work,days:[]});
   weeks.get(work.week).days.push({...day,weekday:work.weekday});
 }
 return [...grouped].sort((a,b)=>b[0]-a[0]).map(([year,weeks])=>({year,weeks:[...weeks.values()].sort((a,b)=>b.week-a.week).map(week=>({...week,count:week.days.length}))}));
}
function dailyArchiveHtml(){
 const archive=dailyWorkYears();
 const today=dailyWorkWeek(dailyToday()),current=dailyWorkWeek(Daily.date);
 const years=[...new Set([today.year,current.year,...archive.map(row=>row.year)])].sort((a,b)=>b-a);
 const year=Daily.year||current.year;
 const record=archive.find(row=>row.year===year);
 const weeks=record?.weeks.filter(row=>Daily.week==null||row.week===Daily.week)||[];
 const maxWeek=dailyWorkWeek(`${year}-12-28`).week;
 return `<h3>工作周日志</h3><label>工作年</label><select id="dailyYear" onchange="dailyArchiveFilter(Number(this.value),null)">${years.map(value=>`<option value="${value}" ${value===year?'selected':''}>${value} 年</option>`).join('')}</select><label class="daily-filter-label">工作周（周一至周日）</label><select id="dailyWeek" onchange="dailyArchiveFilter(Daily.year,this.value?Number(this.value):null)"><option value="">全部工作周</option>${Array.from({length:maxWeek},(_,index)=>index+1).map(week=>`<option value="${week}" ${week===Daily.week?'selected':''}>第 ${week} 周</option>`).join('')}</select><div class="daily-archive-days">${weeks.map(week=>`<section><h4>${year} 年 第 ${week.week} 周工作日志</h4><div class="muted">${week.start_date.slice(5)} 至 ${week.end_date.slice(5)}</div>${week.days.map(day=>`<button class="daily-archive-day ${day.log_date===Daily.date?'active':''}" onclick="loadDailyLog('${day.log_date}')"><strong>${day.log_date} 星期${'一二三四五六日'[(day.weekday||dailyWorkWeek(day.log_date).weekday)-1]}</strong></button>`).join('')}</section>`).join('')||'<p class="muted">当前工作周暂无已保存日志。可选择日期新建。</p>'}</div>`;
}
function dailyArchiveFilter(year,week){Daily.year=year;Daily.week=week;$('#dailyArchive').innerHTML=dailyArchiveHtml();}

function dailyItemHtml(item){
 const kind=item.entity_kind==='task'?'Task':'Issue';
 return `<article class="daily-history-item"><strong>${esc(item.project_name)} · ${kind}-${item.display_id} · ${esc(item.title)}</strong><div class="daily-history-result">${esc(item.result||'当时未填写结果')}</div></article>`;
}
function dailyPoolHtml(projectId="",query=""){
 const needle=query.trim().toLowerCase();
 const projects=Daily.available.projects.filter(project=>!projectId||String(project.id)===String(projectId));
 return projects.map(project=>{
   const items=project.items.filter(item=>!needle||`${item.title} ${item.project_name} ${item.entity_kind==='task'?'Task':'Issue'}-${item.display_id}`.toLowerCase().includes(needle));
   return `<section class="daily-source-project"><h4>${esc(project.name)} <span class="muted">${items.length} 项</span></h4>${items.map(item=>`<div class="daily-source-item" data-source-key="${dailyKey(item)}"><button class="daily-source-link" title="${esc(item.title)}" onclick="dailyOpenSource('${item.entity_kind}',${item.entity_id},${project.id})">${item.entity_kind==='task'?'Task':'Issue'}-${item.display_id} · ${esc(item.title)}</button><div class="muted">${esc(item.snapshot_status)}${item.priority?' · '+esc(item.priority):''}</div></div>`).join('')||'<p class="muted">没有符合条件的未完成事项</p>'}</section>`;
 }).join('')||'<p class="muted">暂无项目，可先创建项目和任务。</p>';
}
let DailyDetailRequest=0;
async function dailyOpenSource(kind,id,projectId){
 if(Daily.saving||Daily.loading)return;
 if(!['task','issue'].includes(kind))return;
 const request=++DailyDetailRequest;
 showModal('事项详情','<p class="muted">正在加载描述…</p>');
 try{
   const rows=await api(`/api/${kind==='task'?'tasks':'issues'}/${projectId}`);
   if(request!==DailyDetailRequest||S.tab!=='daily'||$('#modal').classList.contains('hidden'))return;
   const item=rows.find(row=>Number(row.id)===Number(id));
   if(!item){showModal('事项详情','<p>该事项已删除或不存在，请刷新右侧事项列表。</p>');return;}
   const project=Daily.available.projects.find(row=>Number(row.id)===Number(projectId));
   const task=kind==='task';
   showModal(`${task?'Task':'Issue'}-${item.display_id} · ${item.title}`,`<div class="daily-source-detail"><p class="muted">${esc(project?.name||'')} · ${esc(item.status)} · ${esc(item.priority||item.severity||'')}</p>${task?`<p>开始：${esc(item.start_date||'—')}　截止：${esc(item.due_date||'—')}</p>`:''}<p>软件版本：${esc((item.versions||[]).join('、')||'未关联')}</p><h4>${task?'任务描述':'Issue 描述'}</h4><div class="daily-description">${esc(item.description||'暂无描述')}</div>${!task?`<h4>根因</h4><div class="daily-description">${esc(item.root_cause||'暂无记录')}</div><h4>解决方案</h4><div class="daily-description">${esc(item.solution||'暂无记录')}</div>`:''}<div class="actions" style="justify-content:flex-end;margin-top:16px"><button onclick="closeModal()">返回日志</button></div></div>`,'large');
 }catch(error){if(request===DailyDetailRequest&&S.tab==='daily'&&!$('#modal').classList.contains('hidden'))showModal('事项详情',`<p>描述加载失败：${esc(error.message)}</p><button onclick="closeModal()">返回日志</button>`);}
}
function dailyRefreshPoolView(){const project=$("#dailyPoolProject")?.value||"",query=$("#dailyPoolSearch")?.value||"";$("#dailyPoolItems").innerHTML=dailyPoolHtml(project,query);}

function renderDailyLog(){
 if(S.tab!=="daily"||!Daily.log)return;
 syncNavigation();
 const log=Daily.log;
 $("#content").innerHTML=`<div class="daily-workbench"><aside class="card daily-archive" id="dailyArchive">${dailyArchiveHtml()}</aside><main class="daily-editor"><div class="card"><div class="actions"><h3>每日日志</h3><span class="spacer"></span><button onclick="dailyShiftDay(-1)">前一天</button><input id="dailyDate" class="daily-date" type="date" value="${Daily.date}" onchange="loadDailyLog(this.value)"><button onclick="dailyShiftDay(1)">后一天</button><button onclick="loadDailyLog(dailyToday())">今天</button></div>
 <div class="daily-writing-columns"><section><label>今天计划做什么</label><textarea id="dailyPlanned" class="daily-main-text" placeholder="今天的目标、安排和优先事项…" oninput="dailyFieldUpdate('planned',this.value)">${esc(log.planned)}</textarea>
 </section><section><label>今天实际做了什么</label><textarea id="dailyActual" class="daily-main-text" placeholder="实际完成内容、结果和遇到的问题…" oninput="dailyFieldUpdate('actual',this.value)">${esc(log.actual)}</textarea>
 </section></div><label>明日计划</label><textarea id="dailyTomorrow" class="daily-main-text" placeholder="明天的目标、安排和需要跟进的事项…" oninput="dailyFieldUpdate('tomorrow',this.value)">${esc(log.tomorrow||"")}</textarea>
 <div class="actions daily-save-row"><span class="muted" id="dailySaveStatus">${Daily.dirty?"有未保存的修改":log.id?"已保存 · "+esc(displayDateTime(log.updated_at)):"新日志，尚未保存"}</span><span class="spacer"></span><button id="dailySaveButton" class="primary" onclick="saveDailyLog()">保存当天日志</button></div></div>
 ${log.items.length?`<details class="card daily-legacy-records"><summary>历史关联事项记录 · ${log.items.length} 项</summary><p class="muted">旧日志的事项与工作结果保留展示，新日志无需加入项目事项。</p>${log.items.map(dailyItemHtml).join('')}</details>`:''}</main>
 <aside class="card daily-pool"><h3>各项目未完成事项</h3><div class="field-help">点击任务或 Issue 查看具体描述，不会离开日志或改变日志内容。</div><label>项目</label><select id="dailyPoolProject" onchange="dailyRefreshPoolView()"><option value="">全部项目</option>${Daily.available.projects.map(project=>`<option value="${project.id}">${esc(project.name)}</option>`).join("")}</select><label class="daily-filter-label">搜索</label><input id="dailyPoolSearch" placeholder="搜索任务、Issue 或编号" oninput="dailyRefreshPoolView()"><div class="actions daily-source-actions"><button onclick="dailyRefreshAvailable()">刷新事项</button></div><div id="dailyPoolItems">${dailyPoolHtml()}</div></aside></div>`;
}
function dailyFieldUpdate(field,value){Daily.log[field]=field==="progress"?dailyPercent(value):value;dailyMarkDirty();if(field==="progress"){const bar=$("#dailyProgressBar");if(bar)bar.style.width=Daily.log.progress+"%";}}
function dailyPercent(value){return Math.min(100,Math.max(0,Math.round(Number(value)||0)));}
async function dailyRefreshAvailable(){try{Daily.available=await api("/api/daily-logs/available");if(S.tab==="daily")dailyRefreshPoolView();}catch(error){alert("刷新事项失败："+error.message);}}
async function saveDailyLog(){
 if(Daily.saving||Daily.loading||!Daily.log)return;
 const payload={revision:Daily.log.revision,planned:Daily.log.planned,actual:Daily.log.actual,tomorrow:Daily.log.tomorrow||"",progress:Daily.log.progress,items:Daily.log.items.map(item=>({entity_kind:item.entity_kind,entity_id:item.entity_id,progress:item.progress,result:item.result}))};
 Daily.saving=true;dailyDisableControls(true);
 try{
   Daily.log=await api(`/api/daily-logs/${Daily.date}`,{method:"PUT",body:JSON.stringify(payload)});Daily.dirty=false;
   try{Daily.archive=await api("/api/daily-logs/archive");}catch(error){alert("日志已保存，但归档刷新失败，请稍后重新打开页面。");}
 }catch(error){alert("保存失败，输入内容已保留："+error.message);}
 finally{Daily.saving=false;renderDailyLog();}
}
function dailyDisableControls(disabled){document.querySelectorAll('.daily-workbench input,.daily-workbench textarea,.daily-workbench button,.daily-workbench select,.tabs button[data-context="daily"]').forEach(el=>el.disabled=disabled);}
