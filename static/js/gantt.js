// projectmanager 3.21.0 — gantt
// Classic script: shared globals preserve existing HTML event handlers.
async function gantt(){
 const rows=await api(`/api/tasks/${S.projectId}?sort=status`);
 const valid=rows.filter(x=>parseIsoDateUTC(x.start_date) && parseIsoDateUTC(x.due_date));

 if(!valid.length){
   $("#content").innerHTML=`<div class="card"><h3>甘特图</h3><div class="muted">暂无包含开始/截止日期的任务。</div></div>`;
   return;
 }

 const parseDate=parseIsoDateUTC;
 const fmtMonth=d=>`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}`;
 const daysInMonth=(y,m)=>new Date(Date.UTC(y,m+1,0)).getUTCDate();
 const monthStart=d=>new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1));
 const addMonths=(d,n)=>new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+n,1));
 const monthDiff=(a,b)=>(b.getUTCFullYear()-a.getUTCFullYear())*12+(b.getUTCMonth()-a.getUTCMonth());

 const todayText=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
 const today=parseDate(todayText);

 const starts=valid.map(x=>parseDate(x.start_date)).filter(Boolean);
 const dues=valid.map(x=>parseDate(x.due_date)).filter(Boolean);

 const earliest=new Date(Math.min(...starts.map(x=>x.getTime()),today.getTime()));
 const latest=new Date(Math.max(...dues.map(x=>x.getTime()),today.getTime()));

 const minMonth=addMonths(monthStart(earliest),-1);
 const maxMonth=addMonths(monthStart(latest),1);
 const monthCount=monthDiff(minMonth,maxMonth)+1;

 const monthWidth=monthCount<=12?150:monthCount<=24?125:105;
 const timelineWidth=Math.max(900,monthCount*monthWidth);
 const labelWidth=250;

 const dateToX=d=>{
   const mi=monthDiff(minMonth,monthStart(d));
   const dim=daysInMonth(d.getUTCFullYear(),d.getUTCMonth());
   const fraction=(d.getUTCDate()-1)/dim;
   return (mi+fraction)*monthWidth;
 };

 const monthBlocks=[];
 for(let i=0;i<monthCount;i++){
   const d=addMonths(minMonth,i);
   monthBlocks.push(`
     <div class="gantt-month-column" style="left:${i*monthWidth}px;width:${monthWidth}px">
       <div class="gantt-month-label">${fmtMonth(d)}</div>
     </div>
   `);
 }

 const sharedMonthGrid=monthBlocks.map((_,i)=>`
   <div class="gantt-month-divider" style="left:${i*monthWidth}px"></div>
 `).join("") + `<div class="gantt-month-divider" style="left:${monthCount*monthWidth}px"></div>`;

 const todayOffset=dateToX(today);

 const bodyRows=valid.map(x=>{
   const s=parseDate(x.start_date);
   const e=parseDate(x.due_date);
   if(!s||!e)return "";

   const startX=Math.max(0,dateToX(s));
   const eNext=new Date(e.getTime()+86400000);
   const endX=Math.min(timelineWidth,dateToX(eNext));
   const width=Math.max(12,endX-startX);

   return `
     <div class="gantt-row">
       <div class="gantt-task-cell">
         <div class="gantt-task-id">${taskId(x.display_id)}</div>
         <div class="gantt-task-name">${esc(x.title)}</div>
         <div class="gantt-dependency-note">${x.dependency_overdue?"前置延期":x.schedule_conflict?"日期冲突":x.dependency_blocked?"等待前置":""}</div>
       </div>
       <div class="gantt-timeline-row" style="width:${timelineWidth}px">
         ${sharedMonthGrid}
         <div class="gantt-today-line" style="left:${todayOffset}px"></div>
         <div
           class="gantt-bar ${x.dependency_risk?'gantt-risk-bar':''}"
           data-task-id="${x.id}"
           style="left:${startX}px;width:${width}px"
           data-task="${esc(x.title)}"
           data-start="${esc(x.start_date)}"
           data-end="${esc(x.due_date)}"
           tabindex="0"
         ></div>
       </div>
     </div>
   `;
 }).join("");

 $("#content").innerHTML=`
   <div class="card gantt-card">
     <div class="gantt-toolbar">
       <div>
         <h3>甘特图</h3>
         <div class="muted">月份范围：${fmtMonth(minMonth)} ～ ${fmtMonth(maxMonth)} · 今天：${todayText}</div>
       </div>
       <span class="muted">箭头：前置 → 后续任务 · 橙色表示依赖风险</span><button onclick="scrollGanttToToday()">定位到今天</button>
     </div>

     <div class="gantt-scroll-wrap" id="ganttScroll">
       <div class="gantt-grid" style="--gantt-label-width:${labelWidth}px;--gantt-timeline-width:${timelineWidth}px">
         <div class="gantt-header-row">
           <div class="gantt-task-header">任务</div>
           <div class="gantt-timeline-header" style="width:${timelineWidth}px">
             ${monthBlocks.join("")}
             <div class="gantt-today-line gantt-today-header-line" style="left:${todayOffset}px"></div>
             <div class="gantt-today-label" style="left:${todayOffset}px">今天 ${todayText}</div>
           </div>
         </div>
         <div class="gantt-body" id="ganttBody">${bodyRows}<svg id="ganttDependencyLayer" class="gantt-dependency-layer" aria-label="任务依赖箭头"></svg></div>
       </div>
     </div>

     <div id="ganttTooltip" class="gantt-tooltip hidden"></div>
   </div>`;

 const scroller=$("#ganttScroll");
 const tooltip=$("#ganttTooltip");

 const hideTip=()=>tooltip?.classList.add("hidden");
 const showTip=(bar,clientX,clientY)=>{
   if(!tooltip||!bar)return;
   tooltip.innerHTML=`
     <div class="gantt-tooltip-title">${esc(bar.dataset.task||"")}</div>
     <div>开始：${esc(bar.dataset.start||"")}</div>
     <div>结束：${esc(bar.dataset.end||"")}</div>
   `;
   tooltip.classList.remove("hidden");

   const card=tooltip.closest(".gantt-card");
   const rect=card.getBoundingClientRect();
   const tipRect=tooltip.getBoundingClientRect();
   let x=clientX-rect.left+12;
   let y=clientY-rect.top+12;

   x=Math.min(x,rect.width-tipRect.width-12);
   y=Math.min(y,rect.height-tipRect.height-12);
   x=Math.max(8,x);
   y=Math.max(8,y);

   tooltip.style.left=`${x}px`;
   tooltip.style.top=`${y}px`;
 };

 document.querySelectorAll(".gantt-bar").forEach(bar=>{
   bar.addEventListener("mouseenter",e=>showTip(bar,e.clientX,e.clientY));
   bar.addEventListener("mousemove",e=>showTip(bar,e.clientX,e.clientY));
   bar.addEventListener("mouseleave",hideTip);
   bar.addEventListener("focus",()=>{
     const r=bar.getBoundingClientRect();
     showTip(bar,r.left+r.width/2,r.top+r.height/2);
   });
   bar.addEventListener("blur",hideTip);
 });

 if(scroller){
   scroller.addEventListener("scroll",hideTip,{passive:true});
 }

 requestAnimationFrame(()=>{
   drawGanttDependencies(valid);
   if(!scroller)return;
   const target=Math.max(0,labelWidth+todayOffset-scroller.clientWidth*0.55);
   scroller.scrollLeft=target;
 });
}

function scrollGanttToToday(){
 const scroller=$("#ganttScroll");
 const labelWidth=250;
 const line=scroller?.querySelector(".gantt-today-header-line");
 if(!scroller||!line)return;
 const left=parseFloat(line.style.left||"0");
 scroller.scrollTo({
   left:Math.max(0,labelWidth+left-scroller.clientWidth*0.55),
   behavior:"smooth"
 });
}
