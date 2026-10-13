// Primary navigation lives in the sidebar; secondary tools follow its scope.
const PROJECT_TABS=["overview","tasks","gantt","tests","issues","logs","versions"];
function syncNavigation(){
 if(S.tab==="personal")S.scope="personal";
 else if(S.tab==="daily")S.scope="daily";
 else if(PROJECT_TABS.includes(S.tab))S.scope="projects";
 document.querySelectorAll("[data-nav]").forEach(button=>button.classList.toggle("active",button.dataset.nav===S.scope));
 const projects=$("#sidebarProjects");if(projects)projects.hidden=S.scope!=="projects";
 document.querySelectorAll(".tabs button").forEach(button=>{
   button.hidden=(!!button.dataset.context&&button.dataset.context!==S.scope)||(S.tab==="daily"&&button.dataset.tab!=="about");
   button.classList.toggle("active",button.dataset.tab===S.tab);
   if(button.dataset.context==="daily")button.disabled=Daily.saving||Daily.loading;
 });
 document.querySelectorAll("[data-project-action]").forEach(button=>button.hidden=S.scope!=="projects"||!S.projectId||!PROJECT_TABS.includes(S.tab));
}
async function openProjects(){
 if(!allowDailyLogNavigation())return;
 S.scope="projects";S.tab="overview";S.selected=null;S.selectedKind=null;
 const project=S.projects.find(project=>project.id===S.projectId)||S.projects[0];
 if(project)return selectProject(project.id);
 return render();
}

function applySidebarState(){
 const collapsed=localStorage.getItem('sidebarCollapsed')==='1';
 $('#app').classList.toggle('sidebar-collapsed',collapsed);
 const toggle=$('#sidebarToggle');toggle.setAttribute('aria-expanded',String(!collapsed));toggle.title=collapsed?'展开左侧导航':'收起左侧导航';
}
function toggleSidebar(){localStorage.setItem('sidebarCollapsed',localStorage.getItem('sidebarCollapsed')==='1'?'0':'1');applySidebarState();}

const HELP_GUIDES={
 personal:{title:'个人 Dashboard',steps:['从左侧进入个人 Dashboard，查看全部项目的任务、延期、依赖风险与测试统计。','任务状态饼图展示各状态的数量和占比，悬停扇区查看详情；暂无任务时显示空状态。','点击项目名进入项目 Dashboard，点击任务或 Issue 打开对应编辑窗口。']},
 overview:{title:'项目 Dashboard',steps:['从左侧“项目”选择项目，打开上方“项目 Dashboard”。','指标和状态饼图仅统计当前项目，查看可开始、已延期及有依赖风险的任务。','点击任务标题进入编辑，刷新按钮读取最新数据。']},
 tasks:{title:'任务 / 子任务',steps:['点击“新增”，填写标题、状态、优先级、日期、描述与软件版本；版本可下拉多选。','新任务默认安排在同项目或同父任务下最后一个任务截止日之后，可手动修改以安排并行任务。','展开前置任务下拉列表，按编号选择多项；开始日期自动顺延到最晚前置截止日的次日，并保留原时长。','双击任务或选中后点击“编辑选中”；状态和优先级也可在表格里直接修改。','编辑父任务时点击“新建子任务”，状态/优先级、开始/截止均左右并排。子任务超出日期范围时逐级扩展父任务日期。','前置任务不能形成循环或与父子层级冲突，保存失败会保留输入。删除任务前请确认，删除记录会影响关联关系。']},
 gantt:{title:'甘特图',steps:['先给任务设置有效的开始、截止日期，再打开甘特图。','任务条展示时间范围，依赖箭头展示前置执行顺序；悬停任务条查看详情。','日期和依赖通过任务编辑修改，保存后重新打开甘特图查看最新排期。']},
 issues:{title:'Issue',steps:['选择项目后打开 Issue，新增问题并填写类型、严重度、状态及描述。','双击或选中后编辑，记录根因与解决方案，并关联软件版本和同项目测试。展开“关联测试”可多选，表格中的测试链接可打开测试编辑。','Resolved / Closed 事项不会出现在日志的未完成事项池中，历史日志快照仍保留。']},
 tests:{title:'测试',steps:['选择项目后打开测试，新增测试名称、说明及软件版本。版本使用与任务相同的可滚动下拉多选，新增时默认选中最新记录版本，编辑时保留原选择。','执行后更新测试状态，记录结果；双击或选中记录可编辑。','Dashboard 的测试通过率根据已执行且有通过/失败结果的测试计算。']},
 versions:{title:'软件版本',steps:['新增版本号、Git 分支和备注，备注支持 Markdown。','双击或选中后编辑，展开备注查看完整内容。','任务和子任务可关联多个版本，Issue 与测试也可以关联版本。']},
 logs:{title:'研发记录',steps:['选择项目后进入研发记录，在“研发总体事项”新增条目，按目标 / Done / Working / TODO 模板记录项目研发工作。','双击研发事项卡片编辑 Markdown 内容；在 ROS Topic 区域新增接口名称、类型、说明和示例，双击对应行编辑。','跨项目的每日安排和明日计划请使用左侧独立“每日日志”入口。']},
 daily:{title:'每日日志',steps:['从左侧进入每日日志，选择日期，填写今天计划、今天实际和明日计划。','计划和实际完成内容左右并排记录。右侧按项目展示未完成任务和 Issue，可筛选或搜索，点击标题只读查看具体描述。','直接在实际完成内容中记录工作结果，不需要拖拽或勾选项目事项，也不会修改源任务 / Issue 状态。旧日志的关联事项和结果保留为只读历史记录。','点击正文里的“保存当天日志”，只有这一个保存按钮。日期切换和离开页面会提醒未保存内容。','从左侧工作年、工作周打开日志；历史日期仅显示日期和星期，按 ISO 工作周（周一至周日）分类；同一天多页面编辑冲突时不会覆盖另一页内容。','日志页上方仅保留版本信息。可先在其他页面打开帮助，再选择“每日日志”查看本教程。']},
 settings:{title:'设置与备份',steps:['打开设置，修改主题、端口或自动备份选项，点击设置保存按钮。','使用“立即备份”生成数据库副本，包含项目、任务和每日日志等数据。','恢复数据时先退出程序并保留当前数据库副本，再使用所需备份替换数据库；不要在运行中替换数据库文件。']},
 about:{title:'版本信息与导航',steps:['左侧选择个人 Dashboard、项目或每日日志，上方工具栏随当前页面变化。','项目可拖拽调换顺序，也可用上/下箭头移动；顺序保存到数据库。左侧每日日志位于项目上方。点击左侧“收起导航”变为图标栏，再次点击展开，刷新后记住该状态。','版本信息展示当前应用版本；帮助按钮按当前页面打开教程，并可切换至其他功能。']}
};
function openHelp(topic=S.tab){
 const guide=HELP_GUIDES[topic]||HELP_GUIDES.personal;
 const selected=HELP_GUIDES[topic]?topic:'personal';
 showModal('使用帮助 · '+guide.title,`<div class="help-topics">${Object.entries(HELP_GUIDES).map(([key,value])=>`<button type="button" class="${key===selected?'active':''}" onclick="openHelp('${key}')">${esc(value.title)}</button>`).join('')}</div><section class="help-guide"><h4>${esc(guide.title)} · 操作步骤</h4><ol>${guide.steps.map(step=>`<li>${esc(step)}</li>`).join('')}</ol></section><div class="actions" style="justify-content:flex-end"><button onclick="closeModal()">关闭帮助</button></div>`,'large');
}
