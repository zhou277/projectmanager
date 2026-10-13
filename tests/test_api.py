import json
from pathlib import Path
import sqlite3

import pytest
from fastapi.testclient import TestClient

from conftest import application


def create_task(client, project, **fields):
    payload = {"title": "规划路径", "description": "保留描述", "status": "待办", "priority": "中",
               "start_date": "2026-09-01", "due_date": "2026-10-31", **fields}
    result = client.post(f"/api/tasks/{project}", json=payload)
    assert result.status_code == 200, result.text
    return result.json()["id"]


def find_task(client, project, task):
    return next(row for row in client.get(f"/api/tasks/{project}").json() if row["id"] == task)


def test_task_crud_and_version_links(client, project, version):
    task = create_task(client, project, version_ids=[version])
    original = find_task(client, project, task)
    assert original["title"] == "规划路径"
    assert original["versions"] == ["v1.0"]
    assert original["display_id"] == 1
    payload = {**original, "title": "修改路径", "status": "进行中", "priority": "高", "version_ids": [version]}
    assert client.put(f"/api/tasks/item/{task}", json=payload).status_code == 200
    edited = find_task(client, project, task)
    assert (edited["title"], edited["status"], edited["priority"], edited["versions"]) == ("修改路径", "进行中", "高", ["v1.0"])
    assert client.delete(f"/api/tasks/item/{task}").status_code == 200
    assert client.get(f"/api/tasks/{project}").json() == []
    assert application.db.q("SELECT * FROM task_versions WHERE task_id=?", (task,)) == []
    assert client.put(f"/api/tasks/item/{task}", json=payload).status_code == 404


def test_child_creation_cycle_guard_and_parent_deletion(client, project, version):
    parent = create_task(client, project)
    child = create_task(client, project, title="子任务", parent_id=parent, version_ids=[version])
    assert find_task(client, project, child)["parent_id"] == parent
    assert find_task(client, project, child)["versions"] == ["v1.0"]
    for task, parent_id in [(parent, parent), (parent, child)]:
        response = client.put(f"/api/tasks/item/{task}", json={"parent_id": parent_id})
        assert response.status_code == 400
    assert find_task(client, project, parent)["parent_id"] is None
    client.delete(f"/api/tasks/item/{parent}")
    assert find_task(client, project, child)["parent_id"] is None


def test_cross_project_parent_rejected(client, project):
    parent = create_task(client, project)
    other = client.post("/api/projects", json={"name": "另一项目"}).json()["id"]
    assert client.post(f"/api/tasks/{other}", json={"title": "非法父任务", "parent_id": parent}).status_code == 400


@pytest.mark.parametrize("status", ["待办", "进行中", "阻塞", "已完成"])
def test_inline_task_status_preserves_other_fields(client, project, version, status):
    parent = create_task(client, project)
    task = create_task(client, project, parent_id=parent, version_ids=[version])
    before = find_task(client, project, task)
    response = client.patch(f"/api/tasks/item/{task}/status", json={"status": status})
    assert response.status_code == 200
    after = find_task(client, project, task)
    assert after["status"] == status
    assert bool(after["completed_at"]) == (status == "已完成")
    assert {key:value for key,value in after.items() if key not in ("status","completed_at")} == {key:value for key,value in before.items() if key not in ("status","completed_at")}


@pytest.mark.parametrize("priority", ["低", "中", "高", "紧急"])
def test_inline_priority_preserves_other_fields(client, project, version, priority):
    task = create_task(client, project, version_ids=[version])
    before = find_task(client, project, task)
    assert client.patch(f"/api/tasks/item/{task}/priority", json={"priority": priority}).status_code == 200
    assert find_task(client, project, task) == {**before, "priority": priority}


@pytest.mark.parametrize("field", ["status", "priority"])
def test_invalid_inline_change_is_rejected(client, project, field):
    task = create_task(client, project)
    before = find_task(client, project, task)
    assert client.patch(f"/api/tasks/item/{task}/{field}", json={field: "invalid"}).status_code == 400
    assert find_task(client, project, task) == before
    assert client.patch(f"/api/tasks/item/999999/{field}", json={field: "invalid"}).status_code == 404


def test_task_validation_and_status_sort(client, project):
    assert client.post(f"/api/tasks/{project}", json={"title": " "}).status_code == 400
    create_task(client, project, status="已完成")
    running = create_task(client, project, status="进行中")
    create_task(client, project, status="待办")
    assert client.get(f"/api/tasks/{project}?sort=status").json()[0]["id"] == running


def test_issue_edit_and_inline_status(client, project, version):
    issue = client.post(f"/api/issues/{project}", json={"title": "碰撞问题", "version_ids": [version]}).json()["id"]
    payload = {"title": "碰撞已修复", "issue_type": "Bug", "severity": "高", "status": "Resolved",
               "assignee": "tester", "description": "复现步骤", "root_cause": "边界", "solution": "增加判断", "version_ids": [version]}
    assert client.put(f"/api/issues/item/{issue}", json=payload).status_code == 200
    row = client.get(f"/api/issues/{project}").json()[0]
    for key, value in payload.items():
        if key != "version_ids":
            assert row[key] == value
    assert row["versions"] == ["v1.0"] and row["closed_at"]
    assert client.patch(f"/api/issues/item/{issue}/status", json={"status": "Open"}).status_code == 200
    assert client.get(f"/api/issues/{project}").json()[0]["closed_at"] is None


def test_version_edit_updates_linked_entities(client, project, version):
    task = create_task(client, project, version_ids=[version])
    issue = client.post(f"/api/issues/{project}", json={"title": "issue", "version_ids": [version]}).json()["id"]
    payload = {"version": "v1.1", "branch": "feature/very-long-branch", "notes": "**修复**\n\n- 回归测试"}
    assert client.put(f"/api/versions/item/{version}", json=payload).status_code == 200
    row = client.get(f"/api/versions/{project}").json()[0]
    assert all(row[key] == value for key, value in payload.items())
    assert find_task(client, project, task)["versions"] == ["v1.1"]
    assert client.get(f"/api/issues/{project}").json()[0]["versions"] == ["v1.1"]


def test_test_record_edit(client, project, version):
    record = client.post(f"/api/tests/{project}", json={"name": "集成测试", "version_ids": [version]}).json()["id"]
    assert client.put(f"/api/tests/item/{record}", json={"name": "测试修改", "status": "通过", "version_ids": [version]}).status_code == 200
    row = client.get(f"/api/tests/{project}").json()[0]
    assert (row["name"], row["status"], row["versions"]) == ("测试修改", "通过", ["v1.0"])


def test_settings_save_roundtrip_and_validation(client):
    payload = {"theme": "light", "preferred_port": 7777, "auto_backup": True, "backup_dir": "test-backups", "backup_keep": 3}
    response = client.put("/api/settings", json={**payload, "database_path": "ignored"})
    assert response.status_code == 200
    saved = client.get("/api/settings").json()
    assert all(saved[key] == value for key, value in payload.items())
    assert json.loads(application.SETTINGS_PATH.read_text(encoding="utf-8")) == payload
    assert Path(saved["database_path"]) == application.DB_PATH
    assert client.put("/api/settings", json={"preferred_port": "bad"}).status_code == 400
    assert json.loads(application.SETTINGS_PATH.read_text(encoding="utf-8")) == payload


def test_database_backup_contains_real_data(client, project, version):
    task = create_task(client, project, version_ids=[version])
    response = client.post("/api/settings/backup")
    assert response.status_code == 200, response.text
    backup = Path(response.json()["path"])
    assert backup.is_relative_to(application.DATA_DIR)
    with sqlite3.connect(backup) as database:
        assert database.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert database.execute("SELECT title FROM tasks WHERE id=?", (task,)).fetchone()[0] == "规划路径"
        assert database.execute("SELECT version_id FROM task_versions WHERE task_id=?", (task,)).fetchone()[0] == version
    assert find_task(client, project, task)["title"] == "规划路径"


def test_backup_rejects_remote_client(client):
    with TestClient(application.app, client=("192.0.2.1", 50000)) as remote:
        assert remote.post("/api/settings/backup").status_code == 403


def test_backup_retention(client, monkeypatch):
    client.put("/api/settings", json={"backup_keep": 2})
    for index in range(3):
        monkeypatch.setattr(application.time, "strftime", lambda *args, i=index: f"20261007_12000{i}")
        assert client.post("/api/settings/backup").status_code == 200
    assert len(list(application.resolved_backup_dir().glob("*.db"))) == 2


def test_static_module_files_are_served_and_version_updated(client):
    import re

    assert client.get("/api/about").json()["version"] == "3.26.0"
    html = client.get("/").text
    scripts = re.findall(r'<script src="([^"]+)"', html)
    assert scripts[-1] == "/static/app.js"
    assert len(scripts) == len(set(scripts)) == 20
    for script in scripts:
        response = client.get(script)
        assert response.status_code == 200 and response.text.strip()
