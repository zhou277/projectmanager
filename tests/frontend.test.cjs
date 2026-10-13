// No npm packages/build: execute the shipped classic scripts in HTML order.
// This small DOM double verifies behavior/requests/HTML, not browser layout.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'static/index.html'), 'utf8');
const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
const tick = () => new Promise(resolve => setImmediate(resolve));

class Element {
  constructor() {
    this.innerHTML = ''; this.textContent = ''; this.value = ''; this.dataset = {};
    this.style = {}; this.handlers = {}; this.clientWidth = 900;
    this.scrollWidth=1200; this.offsetHeight=104;
    const classes = new Set(['hidden']);
    this.classList = {
      add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c),
      toggle: (c, force) => {
        const on = force === undefined ? !classes.has(c) : force;
        if (on) classes.add(c); else classes.delete(c);
        return on;
      }
    };
  }
  addEventListener(name, handler) { this.handlers[name] = handler; }
  closest() { return this; }
  querySelector() { return null; }
  scrollTo(opts) { this.scrollLeft = opts.left; }
  setAttribute(name,value) {this[name]=value;}
  getBoundingClientRect() {return this.rect||{left:0,right:500,top:0,width:500,height:52};}
}

async function harness({omitModal = false} = {}) {
  const nodes = new Map(); const fields = new Map(); const calls = []; const alerts = [];
  const node = selector => { if (!nodes.has(selector)) nodes.set(selector, new Element()); return nodes.get(selector); };
  const store = new Map();
  const data = {
    tasks: [{id: 10, display_id: 1, title: '父任务 <路径>', parent_id: null, status: '待办', priority: '中',
      project_id:1, project_name:'测试项目', description: '任务描述', start_date: '2026-09-01', due_date: '2026-10-31', versions: ['v1.0']}],
    issues: [{id: 20, project_id:1, project_name:'测试项目', display_id: 1, title: '碰撞 Bug', status: 'Open', severity: '高', versions: ['v1.0']}],
    versions: [{id: 30, version: 'v1.0', branch: 'main', notes: '**说明**'}],
    tests: [{id: 40, name: '测试', status: '未执行', versions: ['v1.0']}]
  };
  let settings = {theme: 'dark', preferred_port: 7000, auto_backup: false, backup_dir: 'backups', backup_keep: 10};
  const document = {
    body: node('body'),
    querySelector(selector) {
      if(selector==='#modalBody #dependencyChoices')return node('#modalBody').innerHTML.includes('id="dependencyChoices"')?node('#dependencyChoices'):null;
      if (selector.startsWith('tr.row-selected') || selector.startsWith('[data-version-note')) return null;
      if (selector.startsWith('#modalBody #f_')) return fields.get(selector.slice('#modalBody #'.length)) || null;
      if (selector.startsWith('#f_')) return fields.get(selector.slice(1)) || null;
      return node(selector);
    },
    querySelectorAll(selector) {
      if (selector === '#modalBody [id^=f_]') return [...fields.values()].filter(element=>element.id?.startsWith('f_'));
      if (selector.includes('input[name=version_id]:checked')) return [...fields.values()].filter(e => e.name === 'version_id' && e.checked);
      if (selector.includes('input[name=dependency_id]:checked')) return [...fields.values()].filter(e=>e.name==='dependency_id'&&e.checked);
      return [];
    },
    getElementById: id => node('#' + id)
  };
  async function fetch(url, opts = {}) {
    const method = opts.method || 'GET'; const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({url, method, body});
    let result = [];
    if (url === '/api/settings') {
      if (method === 'PUT') settings = {...settings, ...body};
      result = settings;
    } else if (url === '/api/settings/backup') result = {ok: true, path: '/temporary/backup.db'};
    else if (url === '/api/projects') result = [{id: 1, name: '测试项目'}];
    else if (url.startsWith('/api/dashboard')) result = {pending: data.tasks, completed: [], risky_issues: data.issues,
      task_total: data.tasks.length, task_done: 0, progress: 0, project_count:1, today:'2026-10-07',
      in_progress:0,overdue_count:0,due_soon_count:1,dependency_blocked_count:0,dependency_risk_count:0,
      completed_this_week:0,high_risk_issues:1,tests_passed:0,tests_failed:0,open_issues:1,test_pass_rate:null,
      status_distribution:{'待办':data.tasks.length,'进行中':0,'阻塞':0,'已完成':0},ready_tasks:data.tasks,
      overdue_tasks:[],due_soon_tasks:data.tasks,dependency_risk_tasks:[],
      latest_version:data.versions[0],projects:[{id:1,name:'测试项目',owner:'tester',task_total:data.tasks.length,task_done:0,progress:0,
        in_progress:0,overdue_count:0,dependency_risk_count:0,high_risk_issues:1,latest_version:data.versions[0]}]};
    else {
      const match = /^\/api\/(tasks|issues|versions|tests)\/(?:item\/)?(\d+)(?:\/(status|priority))?/.exec(url);
      if (match) {
        const [, kind, id, field] = match;
        const rows = data[kind];
        if (method === 'GET') result = rows;
        else if (method === 'POST') {
          const created = {id: 99, display_id: 2, ...body, versions: []}; rows.push(created); result = {id: 99};
        } else if (method === 'DELETE') data[kind] = rows.filter(r => r.id !== Number(id));
        else {
          const row = rows.find(r => r.id === Number(id));
          if (field) row[field] = body[field]; else Object.assign(row, body);
          result = {ok: true};
        }
      }
    }
    return {ok: true, text: async () => JSON.stringify(result)};
  }
  const context = vm.createContext({document, localStorage: {getItem: k => store.get(k) || null, setItem: (k,v) => store.set(k,v)},
    crypto: {randomUUID: () => 'regression-client'}, window: {addEventListener() {}}, navigator: {sendBeacon() {}},
    fetch, Blob, console, alert: message => alerts.push(message), confirm: () => true,
    setInterval() {}, requestAnimationFrame: fn => fn()});
  const run = code => vm.runInContext(code, context);
  for (const script of scripts) {
    if (omitModal && script.endsWith('/modal.js')) continue;
    vm.runInContext(fs.readFileSync(path.join(root, script.slice(1)), 'utf8'), context, {filename: script});
  }
  await tick();
  const initialProjectId=run('S.projectId');
  run('S.projectId=1'); // Business editor tests target project 1 explicitly.
  return {context, run, node, fields, calls, alerts, data, store, initialProjectId,
    form(values) {fields.clear(); for (const [name,value] of Object.entries(values)) fields.set('f_'+name, {id:'f_'+name, value: String(value)});},
    event(value) {const target = new Element(); target.value = value; return {target, stopPropagation() {}};}
  };
}

test('HTML load order has all required modules once, bootstrap last', () => {
  assert.equal(new Set(scripts).size, scripts.length);
  for (const name of ['core','modal','projects','tasks','issues','versions','gantt','settings']) assert.ok(scripts.includes('/static/js/'+name+'.js'));
  assert.equal(scripts.at(-1), '/static/app.js');
  assert.ok(scripts.indexOf('/static/js/modal.js') < scripts.indexOf('/static/js/tasks.js'));
  assert.ok(scripts.indexOf('/static/js/util.js') < scripts.indexOf('/static/js/modal.js'));
});

test('bootstrap initializes and installs row handlers exactly once', async () => {
  const h = await harness();
  assert.equal(h.initialProjectId, null);
  assert.equal(h.run('S.tab'),'personal');
  assert.ok(h.calls.some(call=>call.url==='/api/dashboard'));
  assert.equal(h.node('#content').dataset.editHandlersInstalled, '1');
  const handler = h.node('#content').handlers.dblclick;
  h.run('installContentInteractionHandlers()');
  assert.equal(h.node('#content').handlers.dblclick, handler);
  assert.ok(h.calls.some(c => c.url === '/api/client/register'));
  assert.match(h.node('#content').innerHTML, /个人 Dashboard/);
});

test('missing shared modal is detected before initialization', async () => {
  await assert.rejects(harness({omitModal: true}), /Editing infrastructure missing:.*showModal/);
});

for (const [kind, id, title] of [['task',10,'编辑任务'],['issue',20,'编辑 Issue'],['version',30,'编辑软件版本'],['test',40,'编辑测试']]) {
  test(kind+' selected-row editor opens shared modal with existing values', async () => {
    const h = await harness();
    h.run(`S.selected=${id}; S.selectedKind='${kind}'`);
    await h.run(`editSelected('${kind}')`);
    assert.equal(h.node('#modalTitle').textContent, title);
    assert.equal(h.node('#modal').classList.contains('hidden'), false);
    assert.match(h.node('#modalBody').innerHTML, /保存/);
    assert.match(h.node('#modalBody').innerHTML, /v1.0|测试/);
    h.run('closeModal()');
    assert.equal(h.node('#modal').classList.contains('hidden'), true);
    assert.deepEqual(h.alerts, []);
  });
}

test('double click and edit button dispatch to correct editor', async () => {
  const h = await harness();
  const row = new Element(); row.dataset = {rowKind: 'issue', rowId: '20'};
  const target = {closest: selector => selector.startsWith('tr[') ? row : null};
  h.node('#content').handlers.dblclick({target, preventDefault() {}});
  await tick();
  assert.equal(h.node('#modalTitle').textContent, '编辑 Issue');
  const button = {dataset: {editSelected: 'issue'}};
  h.node('#content').handlers.click({target: {closest: () => button}, preventDefault() {}, stopPropagation() {}});
  await tick();
  assert.equal(h.node('#modalTitle').textContent, '编辑 Issue');
  assert.deepEqual(h.alerts, []);
});

test('task create/edit/delete sends correct HTTP requests and refreshes', async () => {
  const h = await harness();
  h.form({title: '新任务', parent_id: '', status: '待办', priority: '中', version_id: 30});
  await h.run('saveTask(false)'); await tick();
  const create = h.calls.find(c => c.method === 'POST' && c.url === '/api/tasks/1');
  assert.equal(create.body.parent_id, null); assert.deepEqual(create.body.version_ids, [30]);
  h.run('S.selected=10; S.selectedKind="task"');
  h.form({title: '编辑任务', parent_id: '', status: '进行中', priority: '高', version_id: 30});
  await h.run('saveTask(true)'); await tick();
  assert.ok(h.calls.some(c => c.method === 'PUT' && c.url === '/api/tasks/item/10' && c.body.title === '编辑任务'));
  h.run('S.selected=10; S.tab="tasks"');
  await h.run('del("task")'); await tick();
  assert.ok(h.calls.some(c => c.method === 'DELETE' && c.url === '/api/tasks/item/10'));
  assert.ok(!h.data.tasks.some(r => r.id === 10)); assert.deepEqual(h.alerts, []);
});

test('child editor uses parent ID, creates child, reopens parent editor', async () => {
  const h = await harness();
  h.run('S.selected=10; S.selectedKind="task"');
  await h.run('openChildTaskDialog(10)');
  assert.match(h.node('#modalTitle').textContent, /新建子任务/);
  assert.equal(h.node('#modal .modal-card').classList.contains('modal-large'), true);
  h.form({title: '子任务', status: '待办', priority: '中'});
  await h.run('saveChildTask(10)');
  assert.ok(h.calls.some(c => c.method === 'POST' && c.body?.parent_id === 10));
  assert.equal(h.node('#modalTitle').textContent, '编辑任务');
  assert.equal(h.node('#modal .modal-card').classList.contains('modal-large'), false);
  assert.deepEqual(h.alerts, []);
});

test('inline status and priority change use PATCH and preserve parent/title', async () => {
  const h = await harness();
  h.context.change = h.event('进行中'); await h.run('inlineStatusChange(change,10,"task")');
  h.context.change = h.event('紧急'); await h.run('inlinePriorityChange(change,10)');
  const patches = h.calls.filter(c => c.method === 'PATCH');
  assert.deepEqual(patches.map(c => [c.url,c.body]), [['/api/tasks/item/10/status',{status:'进行中'}],['/api/tasks/item/10/priority',{priority:'紧急'}]]);
  assert.equal(h.data.tasks[0].title, '父任务 <路径>'); assert.equal(h.data.tasks[0].parent_id, null);
  assert.match(h.node('#content').innerHTML, /inline-priority-select red/); assert.deepEqual(h.alerts, []);
});

for (const [kind, id, name, fields] of [['issue',20,'saveIssue',{title:'修改 Bug',status:'Resolved',version_id:30}],['version',30,'saveVersion',{version:'v1.1',branch:'release',notes:'**发布**'}]]) {
  test(kind+' save editor sends PUT to selected record', async () => {
    const h = await harness(); h.run(`S.selected=${id}; S.selectedKind='${kind}'`); h.form(fields);
    await h.run(`${name}(true)`); await tick();
    const call = h.calls.find(c => c.method === 'PUT' && c.url === `/api/${kind === 'issue' ? 'issues' : 'versions'}/item/${id}`);
    assert.ok(call); for (const [key,value] of Object.entries(fields)) assert.equal(call.body[key], String(value));
    assert.equal(h.node('#modal').classList.contains('hidden'), true); assert.deepEqual(h.alerts, []);
  });
}

test('gantt renders bars/months/history/today and escapes task names', async () => {
  const h = await harness(); await h.run('gantt()');
  const output = h.node('#content').innerHTML;
  for (const token of ['gantt-bar','gantt-month-column','gantt-today-line','2026-09','2026-10','父任务 &lt;路径&gt;']) assert.ok(output.includes(token), token);
  assert.ok(!/NaN|Infinity|undefined/.test(output));
  assert.ok(h.node('#ganttScroll').scrollLeft >= 0);
  h.node('#ganttScroll').querySelector = () => ({style: {left:'500'}});
  h.run('scrollGanttToToday()'); assert.ok(h.node('#ganttScroll').scrollLeft >= 0);
});

test('empty gantt renders friendly placeholder', async () => {
  const h = await harness(); h.data.tasks.length = 0; await h.run('gantt()');
  assert.match(h.node('#content').innerHTML, /暂无包含开始\/截止日期的任务/);
});

test('settings save persists theme, backup requests existing API', async () => {
  const h = await harness();
  for (const [selector,value] of Object.entries({'#setting_theme':'light','#setting_port':'7777','#setting_backup_dir':' backups ','#setting_backup_keep':'3'})) h.node(selector).value = value;
  h.node('#setting_auto_backup').checked = true;
  await h.run('saveSettings()'); await tick();
  const save = h.calls.find(c => c.url === '/api/settings' && c.method === 'PUT');
  assert.deepEqual(save.body,{theme:'light',preferred_port:7777,auto_backup:true,backup_dir:'backups',backup_keep:3});
  assert.equal(h.store.get('theme'),'light'); assert.equal(h.node('body').classList.contains('light'),true);
  await h.run('backupNow()'); await tick();
  assert.ok(h.calls.some(c => c.url === '/api/settings/backup' && c.method === 'POST'));
  assert.ok(h.alerts.some(a => a.includes('/temporary/backup.db')));
});

test('hierarchy and parent options exclude descendants and self', async () => {
  const h = await harness();
  h.context.rows = [{id:1,display_id:1,title:'root',parent_id:null},{id:2,display_id:2,title:'child',parent_id:1},{id:3,display_id:3,title:'grandchild',parent_id:2},{id:4,display_id:4,title:'other',parent_id:null}];
  assert.deepEqual(Array.from(h.run('hierarchyRows(rows)'), r => [r.id,r._depth]), [[1,0],[2,1],[3,2],[4,0]]);
  const options = h.run('taskParentOptions(rows,rows[0])');
  assert.ok(options.includes('value="4"'));
  for (const id of [1,2,3]) assert.ok(!options.includes(`value="${id}"`));
});

test('markdown utilities escape HTML and unsafe links', async () => {
  const h = await harness();
  const output = h.run('renderMarkdown("**粗体** <script>alert(1)</script> [bad](javascript:alert)")');
  assert.match(output, /<strong>粗体<\/strong>/); assert.ok(!output.includes('<script>')); assert.ok(!output.includes('href="javascript:'));
});

test('dependency choices retain selected predecessors, exclude self, and escape names',async()=>{
 const h=await harness();
 h.context.rows=[{id:10,display_id:1,title:'self'},{id:11,display_id:2,title:'<unsafe>'}];
 const output=h.run('dependencyChoices(rows,{id:10,dependency_ids:[11]})');
 assert.ok(!output.includes('value="10"'));assert.match(output,/value="11" checked/);assert.ok(output.includes('&lt;unsafe&gt;'));
});

test('task form collects dependency checkbox IDs and sends them on save',async()=>{
 const h=await harness();await h.run('taskDialog(true,10)');
 h.form({title:'edited',parent_id:'',version_id:30});
 h.fields.set('dependency-11',{name:'dependency_id',value:'11',checked:true});
 h.fields.set('dependency-12',{name:'dependency_id',value:'12',checked:false});
 await h.run('saveTask(true)');await tick();
 const call=h.calls.find(call=>call.url==='/api/tasks/item/10'&&call.method==='PUT');
 assert.deepEqual(call.body.dependency_ids,[11]);assert.deepEqual(call.body.version_ids,[30]);
});

test('dependency summary distinguishes waiting, delay and schedule conflict',async()=>{
 const h=await harness();
 const output=h.run('dependencySummary({predecessors:[{display_id:2,title:"<unsafe>",status:"待办"}],dependency_blocked:true,dependency_overdue:true,schedule_conflict:true})');
 for(const token of ['Task-2','等待前置','前置延期','日期冲突','&lt;unsafe&gt;'])assert.ok(output.includes(token));
 assert.ok(!output.includes('<unsafe>'));
});

test('gantt draws dependency SVG arrows from measured bar rectangles',async()=>{
 const h=await harness();
 const a=new Element(),b=new Element();
 a.dataset.taskId='10';b.dataset.taskId='11';
 a.rect={left:300,right:400,top:0,height:26};b.rect={left:450,right:550,top:52,height:26};
 const oldQuery=h.context.document.querySelectorAll;
 h.context.document.querySelectorAll=selector=>selector==='.gantt-bar[data-task-id]'?[a,b]:oldQuery(selector);
 h.context.rows=[{id:10,dependency_ids:[]},{id:11,dependency_ids:[10],dependency_risk:true}];
 h.run('drawGanttDependencies(rows)');
 const svg=h.node('#ganttDependencyLayer').innerHTML;
 assert.match(svg,/class="gantt-dependency-path risk"/);assert.match(svg,/d="M 400 13 H 436 V 65 H 450"/);
 assert.match(svg,/url\(#dependencyArrowRisk\)/);assert.equal(h.node('#ganttDependencyLayer').width,1200);
});

test('personal dashboard navigation opens the correct project and task editor',async()=>{
 const h=await harness();await h.run('openDashboardTask(1,10)');
 assert.equal(h.run('S.tab'),'tasks');assert.equal(h.run('S.selected'),10);
 assert.equal(h.node('#modalTitle').textContent,'编辑任务');
 h.run('closeModal()');await h.run('openPersonalDashboard()');
 assert.equal(h.node('#projectTitle').textContent,'个人 Dashboard');
 assert.match(h.node('#content').innerHTML,/各项目概览/);assert.match(h.node('#content').innerHTML,/测试项目/);
 await h.run('openDashboardProject(1)');assert.equal(h.run('S.tab'),'overview');
 assert.match(h.node('#content').innerHTML,/项目 Dashboard/);assert.match(h.node('#content').innerHTML,/v1.0/);
});

test('empty portfolio dashboard provides create-project guidance without NaN',async()=>{
 const h=await harness();h.context.emptyData={project_count:0,task_total:0,task_done:0,progress:0,in_progress:0,overdue_count:0,due_soon_count:0,
 dependency_blocked_count:0,dependency_risk_count:0,completed_this_week:0,high_risk_issues:0,test_pass_rate:null,today:'2026-10-07',
 status_distribution:{'待办':0,'进行中':0,'阻塞':0,'已完成':0},projects:[],ready_tasks:[],overdue_tasks:[],due_soon_tasks:[],dependency_risk_tasks:[],risky_issues:[]};
 const output=h.run('dashboardHtml(emptyData,true)');assert.match(output,/还没有项目/);assert.ok(!/NaN|undefined/.test(output));
});

test('gantt ignores malformed dates instead of emitting invalid timeline coordinates',async()=>{
 const h=await harness();h.data.tasks[0].start_date='2026-02-30';await h.run('gantt()');
 assert.match(h.node('#content').innerHTML,/暂无包含开始\/截止日期的任务/);
 assert.equal(h.run('parseIsoDateUTC("2026-13-01")'),null);
 assert.equal(h.run('parseIsoDateUTC("invalid")'),null);
 assert.equal(h.run('parseIsoDateUTC("2024-02-29").toISOString().slice(0,10)'),'2024-02-29');
});

function setupDaily(h){
 h.run(`S.tab='daily';Daily.date='2026-10-09';Daily.year=2026;Daily.month=10;Daily.dirty=false;
 Daily.log={revision:0,planned:'',actual:'',progress:0,items:[]};
 Daily.available={projects:[{id:1,name:'项目甲',items:[{entity_kind:'task',entity_id:10,project_id:1,project_name:'项目甲',display_id:1,title:'<任务>',snapshot_status:'待办'}]},
 {id:2,name:'项目乙',items:[{entity_kind:'issue',entity_id:20,project_id:2,project_name:'项目乙',display_id:1,title:'问题',snapshot_status:'Open'}]}]};
 Daily.archive={years:[{year:2026,count:1,months:[{month:10,count:1,days:[{log_date:'2026-10-09',progress:40,summary:'<日志>'}]}]}]};`);
}

test('daily journal renders tomorrow plan without percentages and keeps pool/archive',async()=>{
 const h=await harness();setupDaily(h);h.run('renderDailyLog()');
 const output=h.node('#content').innerHTML;
 for(const text of ['今天计划做什么','今天实际做了什么','明日计划','日志归档','2026 年','10 月','项目甲','项目乙','daily-writing-columns','daily-source-link'])assert.ok(output.includes(text),text);
 assert.ok(!output.includes('id="dailyProgress"'));assert.ok(!output.includes('%'));assert.ok(!output.includes('type="number"'));
 assert.ok(output.includes('&lt;任务&gt;'));assert.ok(!output.includes('<任务>'));
});

test('daily project references filter and open read-only descriptions without modifying draft',async()=>{
 const h=await harness();setupDaily(h);h.run('Daily.dirty=true;Daily.log.actual="未保存工作"');
 let output=h.run('dailyPoolHtml("2", "问题")');assert.ok(output.includes('项目乙'));assert.ok(!output.includes('项目甲'));assert.match(output,/dailyOpenSource/);assert.ok(!output.includes('checkbox'));assert.ok(!output.includes('draggable'));
 await h.run('dailyOpenSource("task",10,1)');assert.match(h.node('#modalBody').innerHTML,/任务描述/);assert.match(h.node('#modalBody').innerHTML,/任务描述/);assert.ok(!h.node('#modalBody').innerHTML.includes('id="f_'));
 assert.equal(h.run('S.tab'),'daily');assert.equal(h.run('Daily.dirty'),true);assert.equal(h.run('Daily.log.actual'),'未保存工作');assert.equal(h.run('Daily.log.items.length'),0);
 assert.ok(h.calls.filter(call=>call.url.startsWith('/api/tasks')).every(call=>call.method==='GET'));
 await h.run('dailyOpenSource("issue",20,2)');assert.match(h.node('#modalBody').innerHTML,/Issue 描述/);assert.match(h.node('#modalBody').innerHTML,/解决方案/);
});

test('daily removed or failed reference keeps draft and reports a readable error',async()=>{
 const h=await harness();setupDaily(h);h.run('Daily.dirty=true;Daily.log.planned="保留计划"');
 await h.run('dailyOpenSource("task",999,1)');assert.match(h.node('#modalBody').innerHTML,/已删除或不存在/);
 h.context.fetch=async()=>({ok:false,text:async()=>'not available'});await h.run('dailyOpenSource("task",10,1)');assert.match(h.node('#modalBody').innerHTML,/加载失败/);
 assert.equal(h.run('Daily.log.planned'),'保留计划');assert.equal(h.run('Daily.dirty'),true);
});

test('closing or superseding a description request cannot reopen an outdated modal',async()=>{
 const h=await harness();setupDaily(h);let resolveFirst;
 h.context.fetch=()=>new Promise(resolve=>{resolveFirst=resolve;});
 const first=h.run('dailyOpenSource("task",10,1)');h.run('closeModal()');
 resolveFirst({ok:true,text:async()=>JSON.stringify(h.data.tasks)});await first;
 assert.ok(h.node('#modal').classList.contains('hidden'));
 const pending=[];h.context.fetch=()=>new Promise(resolve=>pending.push(resolve));
 const oldRequest=h.run('dailyOpenSource("task",10,1)');const newRequest=h.run('dailyOpenSource("issue",20,2)');
 pending[1]({ok:true,text:async()=>JSON.stringify(h.data.issues)});await newRequest;assert.match(h.node('#modalTitle').textContent,/Issue-1/);
 pending[0]({ok:true,text:async()=>JSON.stringify(h.data.tasks)});await oldRequest;assert.match(h.node('#modalTitle').textContent,/Issue-1/);
});

test('daily unsaved navigation cancellation keeps draft and save lock prevents leaving',async()=>{
 const h=await harness();setupDaily(h);h.context.confirm=()=>false;h.run('Daily.dirty=true');
 assert.equal(h.run('allowDailyLogNavigation()'),false);assert.equal(h.run('Daily.dirty'),true);
 await h.run('openPersonalDashboard()');assert.equal(h.run('S.tab'),'daily');
 h.context.confirm=()=>true;assert.equal(h.run('allowDailyLogNavigation()'),true);
 h.run('Daily.saving=true');assert.equal(h.run('allowDailyLogNavigation()'),false);
 await h.run('dailyOpenSource("task",10,1)');assert.equal(h.run('Daily.log.items.length'),0);
});

test('daily save sends revision, text and item progress to dated endpoint',async()=>{
 const h=await harness();setupDaily(h);h.run('Daily.log.items=[{entity_kind:"task",entity_id:10,progress:75,result:"旧工作记录"}];dailyFieldUpdate("planned","计划");dailyFieldUpdate("actual","完成工作");dailyFieldUpdate("progress",75)');
 const calls=[];h.context.fetch=async(url,options={})=>{calls.push([url,options]);return {ok:true,text:async()=>JSON.stringify(url.endsWith('/archive')?{years:[]}:{id:1,revision:1,updated_at:'now',planned:'计划',actual:'完成工作',progress:75,items:[]})};};
 await h.run('saveDailyLog()');const call=calls.find(([url])=>url==='/api/daily-logs/2026-10-09');
 const body=JSON.parse(call[1].body);assert.equal(body.revision,0);assert.equal(body.progress,75);assert.equal(body.items[0].entity_id,10);
 assert.equal(h.run('Daily.dirty'),false);assert.equal(h.run('Daily.log.revision'),1);
});

test('daily rejected save retains all unsaved text',async()=>{
 const h=await harness();setupDaily(h);h.run('dailyFieldUpdate("actual","保留这段工作记录")');
 h.context.fetch=async()=>({ok:false,text:async()=>'revision conflict'});
 await h.run('saveDailyLog()');assert.equal(h.run('Daily.log.actual'),'保留这段工作记录');
 assert.equal(h.run('Daily.dirty'),true);assert.ok(h.alerts.some(text=>text.includes('输入内容已保留')));
});

test('primary navigation appears only in sidebar and secondary toolbar is contextual',async()=>{
 const h=await harness();
 const markup=html.split('<nav class="tabs">')[1].split('</nav>')[0];
 assert.ok(!markup.includes('data-tab="personal"'));assert.ok(!markup.includes('data-tab="daily"'));
 const personal=new Element(),daily=new Element(),project=new Element(),settings=new Element();
 personal.dataset={context:'personal'};daily.dataset={context:'daily'};project.dataset={context:'projects',tab:'tasks'};settings.dataset={tab:'settings'};
 const old=h.context.document.querySelectorAll;
 h.context.document.querySelectorAll=selector=>selector==='.tabs button'?[personal,daily,project,settings]:old(selector);
 h.run('S.tab="personal";syncNavigation()');assert.equal(personal.hidden,false);assert.equal(daily.hidden,true);assert.equal(project.hidden,true);assert.equal(settings.hidden,false);assert.equal(h.node('#sidebarProjects').hidden,true);
 h.run('S.tab="daily";syncNavigation()');assert.equal(personal.hidden,true);assert.equal(daily.hidden,true);assert.equal(project.hidden,true);assert.equal(settings.hidden,true);
 h.run('S.tab="tasks";syncNavigation()');assert.equal(project.hidden,false);assert.equal(daily.hidden,true);assert.equal(h.node('#sidebarProjects').hidden,false);
});

test('sidebar projects respects unsaved journal cancellation and supports empty projects',async()=>{
 const h=await harness();setupDaily(h);h.run('Daily.dirty=true');h.context.confirm=()=>false;
 await h.run('openProjects()');assert.equal(h.run('S.tab'),'daily');
 h.context.confirm=()=>true;await h.run('openProjects()');assert.equal(h.run('S.tab'),'overview');assert.equal(h.run('S.scope'),'projects');
 h.run('S.projects=[];S.projectId=null');await h.run('openProjects()');assert.match(h.node('#content').innerHTML,/选择或新建项目/);
});

test('predecessor dropdown sorts by local ID and excludes incompatible hierarchy choices',async()=>{
 const h=await harness();
 const rows=[{id:12,display_id:3,title:'第三项',parent_id:null},{id:11,display_id:2,title:'第二项',parent_id:null},{id:10,display_id:1,title:'第一项',parent_id:null},{id:13,display_id:4,title:'子任务',parent_id:10}];
 h.context.choiceRows=rows;
 const output=h.run('dependencyChoices(choiceRows,{id:11,dependency_ids:[12]})');
 assert.match(output,/<details class="multi-select"/);assert.match(output,/<summary>已选择 1 项/);
 assert.ok(output.indexOf('Task-1')<output.indexOf('Task-3'));
 assert.ok(!output.includes('value="11"'));
 const childOutput=h.run('dependencyChoices(choiceRows,{id:13,parent_id:10})');
 assert.ok(!childOutput.includes('value="10"'));
 const parentOutput=h.run('dependencyChoices(choiceRows,{id:10})');
 assert.ok(!parentOutput.includes('value="13"'));
});

test('date preview uses latest predecessor and preserves duration',async()=>{
 const h=await harness();h.form({start_date:'2026-10-02',due_date:'2026-10-04'});
 const original=h.context.document.querySelectorAll;
 h.context.document.querySelectorAll=selector=>selector==='input[name="dependency_id"]:checked'?[{value:'10'},{value:'11'}]:original(selector);
 h.run('TaskDateRows=[{id:10,due_date:"2026-10-10"},{id:11,due_date:"2026-10-15"}];previewTaskDates()');
 assert.equal(h.fields.get('f_start_date').value,'2026-10-16');assert.equal(h.fields.get('f_due_date').value,'2026-10-18');
 h.run('previewTaskDates()');assert.equal(h.fields.get('f_due_date').value,'2026-10-18');
 h.fields.get('f_start_date').value='2026-11-01';h.fields.get('f_due_date').value='2026-11-03';
 h.run('previewTaskDates()');assert.equal(h.fields.get('f_start_date').value,'2026-11-01');
});

test('child default dates use sibling ends and future parent start',async()=>{
 const h=await harness();h.run('dailyToday=()=>"2026-10-10"');
 assert.equal(h.run('nextTaskDate([{id:1,parent_id:null,start_date:"2026-10-20",due_date:"2026-10-30"}],1)'),'2026-10-20');
 assert.equal(h.run('nextTaskDate([{id:1,parent_id:null,due_date:"2026-10-30"},{id:2,parent_id:1,due_date:"2026-10-22"}],1)'),'2026-10-23');
});

test('task and child editors render paired controls and version multi-select without dropping versions',async()=>{
 const h=await harness();h.data.versions.push({id:31,version:'v2.0'});h.data.tasks[0].versions=['v1.0','v2.0'];
 await h.run('taskDialog(true,10)');let output=h.node('#modalBody').innerHTML;
 assert.match(output,/task-status-priority/);assert.match(output,/name="version_id" value="30" checked/);assert.match(output,/name="version_id" value="31" checked/);
 assert.ok(!output.includes('id="f_version_id"'));
 await h.run('openChildTaskDialog(10)');output=h.node('#modalBody').innerHTML;
 assert.match(output,/task-status-priority/);assert.match(output,/task-date-pair/);assert.match(output,/<details class="multi-select"/);assert.match(output,/name="version_id"/);
});

test('sidebar collapse state persists and updates accessibility label',async()=>{
 const h=await harness();h.run('toggleSidebar()');
 assert.equal(h.store.get('sidebarCollapsed'),'1');assert.ok(h.node('#app').classList.contains('sidebar-collapsed'));
 assert.equal(h.node('#sidebarToggle')['aria-expanded'],'false');
 h.run('applySidebarState()');assert.ok(h.node('#app').classList.contains('sidebar-collapsed'));
 h.run('toggleSidebar()');assert.equal(h.store.get('sidebarCollapsed'),'0');assert.equal(h.node('#sidebarToggle')['aria-expanded'],'true');
});

test('journal result and tomorrow payload retain historical data without completion controls',async()=>{
 const h=await harness();setupDaily(h);h.run('Daily.log.progress=37;Daily.log.items=[{entity_kind:"task",entity_id:10,project_name:"项目甲",display_id:1,title:"历史任务",progress:100,result:"历史工作结果"}];dailyFieldUpdate("tomorrow","明天继续");renderDailyLog()');
 let output=h.node('#content').innerHTML;assert.ok(!output.includes('daily-item-done'));assert.ok(!output.includes('当天完成'));assert.ok(!output.includes('%'));assert.ok(!output.includes('type="number"'));
 assert.match(output,/历史工作结果/);assert.match(output,/历史关联事项记录/);assert.ok(!output.includes("移除"));assert.equal(h.run('Daily.log.progress'),37);assert.equal(h.data.tasks[0].status,'待办');
 const calls=[];h.context.fetch=async(url,options={})=>{calls.push([url,options]);return {ok:true,text:async()=>JSON.stringify(url.endsWith('/archive')?{years:[]}:{id:1,revision:1,planned:'',actual:'',tomorrow:'明天继续',progress:37,items:[]})};};
 await h.run('saveDailyLog()');const body=JSON.parse(calls.find(([url])=>url==='/api/daily-logs/2026-10-09')[1].body);
 assert.equal(body.tomorrow,'明天继续');assert.equal(body.progress,37);assert.equal(body.items[0].progress,100);
 const css=fs.readFileSync(path.join(root,'static/style.css'),'utf8');assert.match(css,/\.daily-source-link\{[^}]*white-space:nowrap/);
});

test('status pie handles mixed, single, empty and malformed counts without invalid SVG',async()=>{
 const h=await harness();
 let output=h.run('dashboardStatusChart({status_distribution:{"待办":3,"进行中":1,"阻塞":0,"已完成":4}})');
 assert.equal((output.match(/class="dashboard-pie-slice"/g)||[]).length,3);assert.match(output,/37\.5%/);assert.match(output,/共 8 项/);assert.ok(!output.includes('dashboard-status-track'));
 output=h.run('dashboardStatusChart({status_distribution:{"已完成":5}})');assert.match(output,/<circle[^>]*dashboard-pie-slice/);assert.match(output,/100\.0%/);
 output=h.run('dashboardStatusChart({status_distribution:{"待办":0}})');assert.match(output,/暂无任务/);assert.ok(!output.includes('NaN'));assert.ok(!output.includes('dashboard-pie-slice'));
 output=h.run('dashboardStatusChart({status_distribution:{"<状态>":-4,"bad":Infinity}})');assert.match(output,/&lt;状态&gt;/);assert.ok(!output.includes('NaN'));assert.match(output,/共 0 项/);
});

test('journal toolbar only shows version info and exactly one save button remains',async()=>{
 const h=await harness();setupDaily(h);
 const about=new Element(),settings=new Element(),help=new Element(),personal=new Element();
 about.dataset={tab:'about'};settings.dataset={tab:'settings'};help.dataset={tool:'help'};personal.dataset={context:'personal'};
 const old=h.context.document.querySelectorAll;
 h.context.document.querySelectorAll=selector=>selector==='.tabs button'?[about,settings,help,personal]:old(selector);
 h.run('syncNavigation();renderDailyLog()');assert.equal(about.hidden,false);assert.equal(settings.hidden,true);assert.equal(help.hidden,true);assert.equal(personal.hidden,true);
 assert.ok(!html.includes('data-context="daily"'));assert.equal((h.node('#content').innerHTML.match(/onclick="saveDailyLog\(\)"/g)||[]).length,1);
 h.run('S.tab="personal";syncNavigation()');assert.equal(help.hidden,false);assert.equal(settings.hidden,false);
});

test('help opens contextual teaching and switches topics without changing page or draft',async()=>{
 const h=await harness();h.run('S.tab="tasks";openHelp()');assert.equal(h.node('#modalTitle').textContent,'使用帮助 · 任务 / 子任务');assert.match(h.node('#modalBody').innerHTML,/前置任务/);
 setupDaily(h);h.run('Daily.dirty=true;Daily.log.actual="未保存工作";openHelp("daily")');assert.match(h.node('#modalBody').innerHTML,/明日计划/);assert.match(h.node('#modalBody').innerHTML,/只有这一个保存按钮/);
 assert.equal(h.run('S.tab'),'daily');assert.equal(h.run('Daily.dirty'),true);assert.equal(h.run('Daily.log.actual'),'未保存工作');
 const topics=h.run('Object.keys(HELP_GUIDES)');for(const topic of topics){h.run(`openHelp(${JSON.stringify(topic)})`);assert.match(h.node('#modalBody').innerHTML,/<ol>/);}
});
