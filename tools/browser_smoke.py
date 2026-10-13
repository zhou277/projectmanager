"""Release QA using installed Chrome, temporary data, and the real HTTP server."""
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
from urllib.request import Request, urlopen

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
CHROME = os.environ.get("PROJECTMANAGER_CHROME", r"C:\Program Files\Google\Chrome\Application\chrome.exe")
artifacts = ROOT / ".browser-qa"
artifacts.mkdir(exist_ok=True)
with socket.socket() as available:
    available.bind(("127.0.0.1", 0))
    port = available.getsockname()[1]
base = f"http://127.0.0.1:{port}"


def request(route, data=None, method=None):
    payload = None if data is None else json.dumps(data).encode()
    with urlopen(Request(base + route, data=payload, method=method, headers={"Content-Type": "application/json"}), timeout=10) as response:
        return json.load(response)


with tempfile.TemporaryDirectory(prefix="pm-browser-321-") as directory:
    env = {**os.environ, "PROJECTMANAGER_DATA_DIR": directory}
    with (artifacts / "server.log").open("w", encoding="utf-8") as log:
        server = subprocess.Popen([sys.executable, "-m", "uvicorn", "app:app", "--host", "127.0.0.1", "--port", str(port), "--log-level", "warning"], cwd=ROOT, env=env, stdout=log, stderr=log, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        try:
            for _ in range(60):
                try:
                    request("/api/about")
                    break
                except Exception:
                    time.sleep(0.1)
            else:
                raise RuntimeError("Server failed to start")
            today = datetime.now(timezone(timedelta(hours=8))).date()
            stamp = lambda delta: (today + timedelta(days=delta)).isoformat()
            p = request("/api/projects", {"name": "机器人导航", "owner": "研发组", "start_date": stamp(-20), "target_date": stamp(30)})["id"]
            q = request("/api/projects", {"name": "机械臂控制", "owner": "控制组"})["id"]
            v = request(f"/api/versions/{p}", {"version": "v1.8.0", "branch": "release/navigation"})["id"]
            a = request(f"/api/tasks/{p}", {"title": "地图数据采集", "description": "地图任务的详细说明\n采集与校验 <原始数据>", "status": "进行中", "priority": "高", "start_date": stamp(-7), "due_date": stamp(-1), "version_ids": [v]})["id"]
            b = request(f"/api/tasks/{p}", {"title": "路径规划验证", "status": "待办", "priority": "紧急", "start_date": stamp(1), "due_date": stamp(3), "dependency_ids": [a], "version_ids": [v]})["id"]
            c = request(f"/api/tasks/{p}", {"title": "传感器标定", "status": "待办", "priority": "中", "start_date": stamp(-3), "due_date": stamp(1)})["id"]
            request(f"/api/tasks/{q}", {"title": "轨迹控制联调", "status": "进行中", "priority": "高", "start_date": stamp(-2), "due_date": stamp(5)})
            request(f"/api/issues/{p}", {"title": "急停边界检查", "severity": "高", "status": "Open", "version_ids": [v]})
            for status in ["通过", "通过", "失败"]:
                request(f"/api/tests/{p}", {"name": status, "status": status})
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(executable_path=CHROME, headless=True)
                page = browser.new_page(viewport={"width": 1440, "height": 1100}, device_scale_factor=1)
                errors, dialogs = [], []
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.on("dialog", lambda dialog: (dialogs.append(dialog.message), dialog.accept()))
                page.goto(base)
                expect(page.locator("#content")).to_contain_text("各项目概览")
                expect(page.locator("#content")).to_contain_text("机械臂控制")
                expect(page.locator('.dashboard-pie')).to_be_visible()
                expect(page.locator('.dashboard-pie-legend')).to_contain_text('任务总数')
                assert page.locator('.dashboard-pie-slice').count()==2
                page.locator('.tabs [data-tool=help]').click()
                expect(page.locator('#modalTitle')).to_have_text('使用帮助 · 个人 Dashboard')
                expect(page.locator('.help-guide')).to_contain_text('饼图')
                page.locator('.help-topics').get_by_role('button',name='每日日志',exact=True).click()
                expect(page.locator('.help-guide')).to_contain_text('明日计划')
                expect(page.locator('.help-guide')).to_contain_text('只有这一个保存按钮')
                expect(page.locator('#projectTitle')).to_have_text('个人 Dashboard')
                page.locator('#modalBody').get_by_role('button',name='关闭帮助',exact=True).click()
                assert page.locator('.tabs button[data-tab=personal]').count()==0
                assert page.locator('.tabs button[data-tab=daily]').count()==0
                assert page.locator('.tabs [data-context=projects]:visible').count()==0
                expect(page.locator('#sidebarProjects')).to_be_hidden()
                assert page.locator('[data-project-action]:visible').count() == 0
                assert page.locator('.dashboard-metrics').evaluate("e=>getComputedStyle(e).gridTemplateColumns.split(' ').length") >= 5
                page.screenshot(path=str(artifacts / "personal-dashboard-dark.png"), full_page=True)

                page.locator('#content').get_by_role('button', name='机器人导航', exact=True).click()
                expect(page.locator('#content')).to_contain_text('项目 Dashboard')
                expect(page.locator('.dashboard-pie')).to_be_visible()
                expect(page.locator('#sidebarProjects')).to_be_visible()
                assert page.locator('.tabs [data-context=projects]:visible').count()==7
                expect(page.locator('#content')).to_contain_text('v1.8.0')
                assert page.locator('[data-project-action]:visible').count() == 2
                page.screenshot(path=str(artifacts / 'project-dashboard.png'), full_page=True)

                page.locator('#content').get_by_role('button', name='Task-2 · 路径规划验证').first.click()
                expect(page.locator('#modalTitle')).to_have_text('编辑任务')
                expect(page.locator(f'input[name=dependency_id][value="{a}"]')).to_be_checked()
                assert page.locator(f'input[name=dependency_id][value="{b}"]').count() == 0
                page.locator('#dependencyChoices summary').click()
                page.locator(f'input[name=dependency_id][value="{c}"]').check()
                page.locator('#modalBody').get_by_role('button', name='保存', exact=True).click()
                expect(page.locator('#modal')).to_be_hidden()
                assert request(f'/api/tasks/item/{b}/dependencies')['dependency_ids'] == [a, c]
                expect(page.locator('#content')).to_contain_text('前置延期')

                # A -> B would create a cycle. UI should keep editor open and explain failure.
                page.locator('#content .task-tree-title').filter(has_text='地图数据采集').dblclick()
                expect(page.locator('#modalTitle')).to_have_text('编辑任务')
                page.locator('#dependencyChoices summary').click()
                page.locator(f'input[name=dependency_id][value="{b}"]').check()
                with page.expect_event('dialog') as cycle_dialog:
                    page.locator('#modalBody').get_by_role('button', name='保存', exact=True).click()
                assert '循环' in cycle_dialog.value.message
                expect(page.locator('#modal')).to_be_visible()
                page.wait_for_function('document.querySelector("#modalBody").textContent.includes("前置任务")')
                assert any('循环' in message for message in dialogs)
                page.locator('#modal .modal-header button').click()
                assert request(f'/api/tasks/item/{a}/dependencies')['dependency_ids'] == []

                # Task and child forms keep status/priority side by side, versions are multi-select.
                page.locator('#content .task-tree-title').filter(has_text='地图数据采集').dblclick()
                expect(page.locator('#modalTitle')).to_have_text('编辑任务')
                expect(page.locator('#f_status')).to_be_visible()
                status_box=page.locator('#f_status').bounding_box()
                priority_box=page.locator('#f_priority').bounding_box()
                assert abs(status_box['y']-priority_box['y'])<2 and priority_box['x']>status_box['x']
                page.get_by_role('button',name='+ 新建子任务',exact=True).click()
                expect(page.locator('#modalTitle')).to_contain_text('新建子任务')
                status_box=page.locator('#f_status').bounding_box()
                priority_box=page.locator('#f_priority').bounding_box()
                assert abs(status_box['y']-priority_box['y'])<2 and priority_box['x']>status_box['x']
                start_box=page.locator('#f_start_date').bounding_box()
                due_box=page.locator('#f_due_date').bounding_box()
                assert abs(start_box['y']-due_box['y'])<2 and due_box['x']>start_box['x']
                assert page.locator(f'#dependencyChoices input[value="{a}"]').count()==0
                page.locator('#f_title').fill('浏览器新增子任务')
                version_details=page.locator('details').filter(has=page.locator('input[name=version_id]'))
                version_details.locator('summary').click()
                page.locator(f'input[name=version_id][value="{v}"]').check()
                expect(version_details.locator('summary')).to_contain_text('已选择 1 项')
                page.screenshot(path=str(artifacts / 'child-task-multi-select.png'), full_page=True)
                page.locator('#f_start_date').fill(stamp(7))
                page.locator('#f_due_date').fill(stamp(8))
                page.get_by_role('button',name='创建子任务',exact=True).click()
                expect(page.locator('#modalTitle')).to_have_text('编辑任务')
                child=next(row for row in request(f'/api/tasks/{p}') if row['title']=='浏览器新增子任务')
                assert child['parent_id']==a and child['versions']==['v1.8.0']
                assert next(row for row in request(f'/api/tasks/{p}') if row['id']==a)['due_date']==stamp(8)
                page.locator('#modal .modal-header button').click()

                page.locator('.tabs button[data-tab=gantt]').click()
                expect(page.locator('.gantt-dependency-path')).to_have_count(2)
                assert page.locator('#ganttDependencyLayer').evaluate('e=>Number(e.getAttribute("width"))') > 0
                assert page.locator('.gantt-dependency-path').first.get_attribute('d').startswith('M ')
                page.screenshot(path=str(artifacts / 'gantt-dependencies.png'), full_page=True)
                page.locator('.gantt-bar').first.hover()
                expect(page.locator('#ganttTooltip')).to_be_visible()

                page.locator('.tabs button[data-tab=tasks]').click()
                page.locator('.tabs [data-tool=help]').click()
                expect(page.locator('#modalTitle')).to_have_text('使用帮助 · 任务 / 子任务')
                expect(page.locator('.help-guide')).to_contain_text('前置任务')
                page.screenshot(path=str(artifacts/'contextual-help.png'),full_page=True)
                page.locator('#modalBody').get_by_role('button',name='关闭帮助',exact=True).click()
                dependent_row=page.locator(f'tr[data-row-id="{b}"]')
                dependent_row.locator('.inline-priority-select').select_option('高')
                expect(page.locator(f'tr[data-row-id="{b}"] .inline-priority-select')).to_have_value('高')
                dependent_row=page.locator(f'tr[data-row-id="{b}"]')
                dependent_row.locator('.inline-status-select').select_option('已完成')
                expect(page.locator(f'tr[data-row-id="{b}"] .inline-status-select')).to_have_value('已完成')
                page.wait_for_function("async()=> (await (await fetch('/api/dashboard')).json()).completed_this_week===1")
                assert request('/api/dashboard')['completed_this_week'] == 1
                page.locator('.personal-dashboard-button').click()
                expect(page.locator('#content')).to_contain_text('各项目概览')
                page.locator('#sidebarToggle').click()
                expect(page.locator('#app')).to_have_class('sidebar-collapsed')
                expect(page.locator('#sidebarToggle')).to_have_attribute('aria-expanded','false')
                page.screenshot(path=str(artifacts / 'sidebar-collapsed.png'), full_page=True)
                page.reload()
                expect(page.locator('#app')).to_have_class('sidebar-collapsed')
                page.locator('#sidebarToggle').click()
                expect(page.locator('#sidebarToggle')).to_have_attribute('aria-expanded','true')
                page.get_by_role('button',name='切换主题',exact=True).click()
                expect(page.locator('body')).to_have_class('light')
                page.screenshot(path=str(artifacts / 'personal-dashboard-light.png'), full_page=True)
                page.set_viewport_size({'width':900,'height':1000})
                page.screenshot(path=str(artifacts / 'personal-dashboard-narrow.png'), full_page=True)
                assert page.locator('.dashboard-grid').evaluate('e=>getComputedStyle(e).gridTemplateColumns.split(" ").length') == 1
                page.reload()
                expect(page.locator('#content')).to_contain_text('各项目概览')
                page.set_viewport_size({'width':1600,'height':1100})
                page.locator('.daily-journal-button').click()
                expect(page.locator('#dailyPlanned')).to_be_visible()
                assert page.locator('.tabs [data-context=projects]:visible').count()==0
                assert page.locator('.tabs button:visible').count()==1
                expect(page.locator('.tabs button:visible')).to_have_attribute('data-tab','about')
                assert page.get_by_role('button',name='保存当天日志',exact=True).count()==1
                expect(page.locator('#sidebarProjects')).to_be_hidden()
                day=page.locator('#dailyDate').input_value()
                page.locator('#dailyPlanned').fill('验证导航算法，处理跨项目问题')
                page.locator('#dailyActual').fill('完成地图数据分析与接口联调')
                page.locator('#dailyTomorrow').fill('明天继续验证导航和机械臂联调')
                assert page.locator('#dailyProgress').count()==0
                assert page.locator('.daily-workbench input[type=number]').count()==0
                assert page.locator('.daily-source-link').first.evaluate('e=>getComputedStyle(e).whiteSpace')=='nowrap'
                planned_box=page.locator('#dailyPlanned').bounding_box()
                actual_box=page.locator('#dailyActual').bounding_box()
                assert abs(planned_box['y']-actual_box['y'])<2 and actual_box['x']>planned_box['x']
                assert page.locator('input[data-daily-select]').count()==0
                assert page.locator('[draggable=true]').count()==0
                assert page.locator('#dailyDropZone').count()==0
                # Reference links open current descriptions without leaving the draft.
                page.locator(f'[data-source-key="task:{a}"] button').click()
                expect(page.locator('.daily-description')).to_contain_text('地图任务的详细说明')
                expect(page.locator('.daily-description')).to_contain_text('<原始数据>')
                assert page.locator('#modalBody input,#modalBody textarea').count()==0
                page.locator('#modalBody').get_by_role('button',name='返回日志',exact=True).click()
                expect(page.locator('#dailyActual')).to_have_value('完成地图数据分析与接口联调')
                expect(page.locator('#dailySaveStatus')).to_contain_text('有未保存')
                issue_q=request(f'/api/issues/{q}',{'title':'控制接口问题','status':'Open','description':'跨项目接口详细说明'})['id']
                page.get_by_role('button',name='刷新事项',exact=True).click()
                expect(page.locator(f'[data-source-key="issue:{issue_q}"] button')).to_be_visible()
                page.locator('#dailyPoolProject').select_option(str(q))
                page.locator('#dailyPoolSearch').fill('控制接口')
                expect(page.locator('.daily-source-link')).to_have_count(1)
                page.locator('.daily-source-link').click()
                expect(page.locator('#modalBody')).to_contain_text('跨项目接口详细说明')
                page.locator('#modalBody').get_by_role('button',name='返回日志',exact=True).click()
                page.locator('#dailyPoolSearch').fill('')
                page.locator('#dailyPoolProject').select_option('')
                page.locator('#dailySaveButton').click()
                expect(page.locator('#dailySaveStatus')).to_contain_text('已保存')
                saved=request(f'/api/daily-logs/{day}')
                assert saved['tomorrow']=='明天继续验证导航和机械臂联调' and len(saved['items'])==0
                assert request(f'/api/tasks/{p}')[0]['status']=='进行中'
                assert request(f'/api/issues/{q}')[0]['status']=='Open'
                page.screenshot(path=str(artifacts/'daily-journal-wide.png'),full_page=True)
                # Old associated results remain readable and survive a new-style save.
                legacy={**saved,'items':[{'entity_kind':'task','entity_id':a,'progress':75,'result':'旧日志事项工作结果'}]}
                request(f'/api/daily-logs/{day}',legacy,method='PUT')
                page.locator('#dailyDate').dispatch_event('change')
                expect(page.locator('.daily-legacy-records')).to_be_visible()
                page.locator('.daily-legacy-records summary').click()
                expect(page.locator('.daily-legacy-records')).to_contain_text('旧日志事项工作结果')
                page.locator('#dailySaveButton').click()
                expect(page.locator('#dailySaveStatus')).to_contain_text('已保存')
                assert request(f'/api/daily-logs/{day}')['items'][0]['result']=='旧日志事项工作结果'

                page.locator('#dailyDate').fill('2025-12-31')
                page.locator('#dailyDate').dispatch_event('change')
                expect(page.locator('#dailyDate')).to_have_value('2025-12-31')
                expect(page.locator('#dailyPlanned')).to_have_value('')
                page.locator('#dailyActual').fill('年度复盘')
                page.locator('#dailySaveButton').click()
                expect(page.locator('#dailySaveStatus')).to_contain_text('已保存')
                expect(page.locator('#dailyArchive')).to_contain_text('2025 年 12 月')
                page.locator('#dailyYear').select_option('2026')
                page.locator('#dailyMonth').select_option(day[5:7].lstrip('0'))
                page.locator('.daily-archive-day').filter(has_text=day[5:]).click()
                expect(page.locator('#dailyActual')).to_have_value('完成地图数据分析与接口联调')
                expect(page.locator('#dailyTomorrow')).to_have_value('明天继续验证导航和机械臂联调')
                expect(page.locator('.daily-history-item')).to_have_count(1)

                # An external update must not silently overwrite this page's draft.
                remote=request(f'/api/daily-logs/{day}')
                request(f'/api/daily-logs/{day}',{'revision':remote['revision'],'planned':remote['planned'],'actual':'另一个页面更新','progress':65,'items':remote['items']},method='PUT')
                page.locator('#dailyActual').fill('必须保留的未保存文字')
                with page.expect_event('dialog') as conflict_dialog:
                    page.locator('#dailySaveButton').click()
                assert '其他页面更新' in conflict_dialog.value.message
                expect(page.locator('#dailySaveButton')).to_be_enabled()
                expect(page.locator('#dailyActual')).to_have_value('必须保留的未保存文字')
                assert any('其他页面更新' in message for message in dialogs)
                page.locator('#dailyDate').dispatch_event('change')
                expect(page.locator('#dailyActual')).to_have_value('另一个页面更新')
                page.set_viewport_size({'width':900,'height':1000})
                page.screenshot(path=str(artifacts/'daily-journal-narrow.png'),full_page=True)
                page.reload()
                expect(page.locator('#content')).to_contain_text('各项目概览')
                page.locator('.daily-journal-button').click()
                expect(page.locator('#dailyActual')).to_have_value('另一个页面更新')
                expect(page.locator('.daily-history-item')).to_have_count(1)
                page.set_viewport_size({'width':1600,'height':1100})
                page.get_by_role('button',name='切换主题',exact=True).click()
                expect(page.locator('body')).not_to_have_class('light')
                page.wait_for_timeout(400)  # Allow existing theme color transitions to finish before visual QA.
                page.screenshot(path=str(artifacts/'daily-journal-dark.png'),full_page=True)
                assert errors == [], errors
                browser.close()
            print('Browser QA passed: dropdown multi-selects, child versions, two-column forms, date propagation, persistent collapsed sidebar, tomorrow plan, parallel plan/actual columns, read-only task/Issue description links, filtering and legacy results, archive and stale-save protection; no JavaScript runtime errors.')
        finally:
            # Windows venv launcher spawns a child interpreter; stop only this QA tree.
            if os.name == "nt":
                subprocess.run(["taskkill", "/PID", str(server.pid), "/T", "/F"], capture_output=True)
            else:
                server.terminate()
            server.wait(timeout=15)
