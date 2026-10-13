// Task dependency controls and finish-to-start indicators.
function parseIsoDateUTC(value){
 const text=String(value||"");
 if(!/^\d{4}-\d{2}-\d{2}$/.test(text))return null;
 const result=new Date(text+"T00:00:00Z");
 return Number.isFinite(result.getTime())&&result.toISOString().slice(0,10)===text?result:null;
}

function dependencyChoices(rows,currentTask=null){
 const selected=new Set(currentTask?.dependency_ids||[]);
 const excluded=currentTask?.id?taskDescendantIds(rows,currentTask.id):new Set();
 if(currentTask?.id)excluded.add(currentTask.id);
 let parent=currentTask?.parent_id;
 while(parent&&!excluded.has(parent)){excluded.add(parent);parent=rows.find(row=>row.id===parent)?.parent_id;}
 const candidates=rows.filter(row=>!excluded.has(row.id)).sort((a,b)=>(a.display_id||a.id)-(b.display_id||b.id));
 return `<div class="wide"><label>前置任务（完成后开始，可多选）</label>
   <details class="multi-select" id="dependencyChoices"><summary>已选择 ${selected.size} 项 · 点击展开</summary><div class="multi-options">${candidates.map(row=>`<label><input type="checkbox" name="dependency_id" onchange="refreshMultiSelect(this);previewTaskDates()" value="${row.id}" ${selected.has(row.id)?"checked":""}> ${taskId(row.display_id)} · ${esc(row.title)}</label>`).join("")||'<span class="muted">暂无其他任务</span>'}</div></details>
   <div class="field-help">父子任务表示层级；前置任务表示执行顺序。选择前置后日期自动顺延，保存时同步更新后续任务及父任务日期。</div></div>`;
}

function dependencySummary(task){
 const predecessors=task.predecessors||[];
 const names=predecessors.map(row=>`${taskId(row.display_id)} · ${row.title}`).join("；");
 const links=predecessors.map(row=>`<span class="dependency-chip ${row.status==="已完成"?"done":""}" title="${esc(row.title)}">${taskId(row.display_id)}</span>`).join("");
 const indicators=[];
 if(task.dependency_blocked)indicators.push('<span class="dependency-indicator waiting">等待前置</span>');
 if(task.dependency_overdue)indicators.push('<span class="dependency-indicator risk">前置延期</span>');
 if(task.schedule_conflict)indicators.push('<span class="dependency-indicator risk">日期冲突</span>');
 return `<div class="dependency-summary" title="${esc(names)}">${links||'<span class="muted">—</span>'}${indicators.join("")}</div>`;
}

function drawGanttDependencies(rows){
 const layer=$("#ganttDependencyLayer"),body=$("#ganttBody");
 if(!layer||!body)return;
 const origin=body.getBoundingClientRect();
 const bars=new Map([...document.querySelectorAll(".gantt-bar[data-task-id]")].map(bar=>[Number(bar.dataset.taskId),bar]));
 const paths=[];
 for(const task of rows){
   const target=bars.get(task.id);
   if(!target)continue;
   for(const predecessorId of (task.dependency_ids||[])){
     const source=bars.get(predecessorId);
     if(!source)continue;
     const a=source.getBoundingClientRect(),b=target.getBoundingClientRect();
     const x1=a.right-origin.left,y1=a.top-origin.top+a.height/2;
     const x2=b.left-origin.left,y2=b.top-origin.top+b.height/2;
     const elbow=Math.max(x1+14,x2-14);
     paths.push(`<path class="gantt-dependency-path ${task.dependency_risk?"risk":""}" d="M ${x1} ${y1} H ${elbow} V ${y2} H ${x2}" marker-end="url(#dependencyArrow${task.dependency_risk?"Risk":""})"><title>前置任务 ${predecessorId} → 任务 ${task.id}</title></path>`);
   }
 }
 layer.setAttribute("width",body.scrollWidth);
 layer.setAttribute("height",body.offsetHeight);
 layer.innerHTML=`<defs><marker id="dependencyArrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#60a5fa"/></marker><marker id="dependencyArrowRisk" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#f97316"/></marker></defs>${paths.join("")}`;
}

let TaskDateRows=[];
function refreshMultiSelect(input){
 const details=input.closest('details');
 details.querySelector('summary').textContent=`已选择 ${details.querySelectorAll('input:checked').length} 项 · 点击展开`;
}
function nextTaskDate(rows,parentId=null){
 const ends=rows.filter(row=>(row.parent_id||null)===(parentId||null)).map(row=>parseIsoDateUTC(row.due_date)).filter(Boolean);
 const parent=rows.find(row=>row.id===parentId);
 const today=parent?.start_date&&parseIsoDateUTC(parent.start_date)&&parent.start_date>dailyToday()?parent.start_date:dailyToday();
 if(!ends.length)return today;
 const latest=new Date(Math.max(...ends.map(value=>value.getTime())));latest.setUTCDate(latest.getUTCDate()+1);
 return latest.toISOString().slice(0,10)>today?latest.toISOString().slice(0,10):today;
}
function previewTaskDates(){
 const startInput=$('#f_start_date'),endInput=$('#f_due_date');
 if(!startInput||!endInput)return;
 const start=parseIsoDateUTC(startInput.value),end=parseIsoDateUTC(endInput.value);
 if(!start||!end)return;
 const ids=new Set([...document.querySelectorAll('input[name="dependency_id"]:checked')].map(input=>Number(input.value)));
 const ends=TaskDateRows.filter(row=>ids.has(row.id)).map(row=>parseIsoDateUTC(row.due_date)).filter(Boolean);
 let target=new Date(start);if(ends.length){const latest=new Date(Math.max(...ends.map(value=>value.getTime())));latest.setUTCDate(latest.getUTCDate()+1);if(target<latest)target=latest;}
 const duration=Math.max(0,end-start);startInput.value=target.toISOString().slice(0,10);endInput.value=new Date(target.getTime()+duration).toISOString().slice(0,10);
}
function installTaskDatePreview(rows){TaskDateRows=rows;for(const selector of ['#f_start_date','#f_due_date']){const input=$(selector);if(input)input.addEventListener('change',previewTaskDates);}}
