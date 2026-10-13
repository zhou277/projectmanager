from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import sqlite3
from threading import Barrier

import pytest

from backend import Database
from conftest import application


def task(client, project, title="task", **fields):
    response = client.post(f"/api/tasks/{project}", json={"title": title, "start_date": "2026-10-01", "due_date": "2026-10-10", **fields})
    assert response.status_code == 200, response.text
    return response.json()["id"]


def row(client, project, task_id):
    return next(value for value in client.get(f"/api/tasks/{project}").json() if value["id"] == task_id)


@pytest.fixture
def calendar(monkeypatch):
    monkeypatch.setattr(application, "today_text", lambda: "2026-10-07")
    monkeypatch.setattr(application, "now_text", lambda: "2026-10-07T14:00")


def test_dependency_create_read_replace_clear(client, project, calendar):
    a, b = task(client, project, "A"), task(client, project, "B", status="已完成")
    dependent = task(client, project, "C", dependency_ids=[a, str(b), a], start_date="2026-10-11")
    result = row(client, project, dependent)
    assert result["dependency_ids"] == [a, b]
    assert [value["title"] for value in result["predecessors"]] == ["A", "B"]
    assert result["dependency_blocked"] is True
    assert result["dependency_risk"] is False
    url = f"/api/tasks/item/{dependent}/dependencies"
    assert client.get(url).json()["dependency_ids"] == [a, b]
    assert client.put(url, json={"dependency_ids": [b]}).status_code == 200
    assert row(client, project, dependent)["dependency_blocked"] is False
    assert client.put(url, json={"dependency_ids": []}).status_code == 200
    assert row(client, project, dependent)["dependency_ids"] == []


@pytest.mark.parametrize("value", [None, "1", {}, [True], [1.5], ["1.5"], [-1], [0], ["invalid"], [999999]])
def test_invalid_dependency_ids_are_rejected_without_writes(client, project, value):
    current = task(client, project, "unchanged")
    response = client.put(f"/api/tasks/item/{current}", json={"title": "must not change", "dependency_ids": value})
    assert response.status_code == 400
    assert row(client, project, current)["title"] == "unchanged"
    assert row(client, project, current)["dependency_ids"] == []
    assert client.post(f"/api/tasks/{project}", json={"title": "must not create", "dependency_ids": value}).status_code == 400
    assert len(client.get(f"/api/tasks/{project}").json()) == 1


def test_self_cross_project_and_missing_dependencies(client, project):
    current = task(client, project)
    other = client.post("/api/projects", json={"name": "other"}).json()["id"]
    foreign = task(client, other)
    url = f"/api/tasks/item/{current}/dependencies"
    for predecessor in (current, foreign):
        assert client.put(url, json={"dependency_ids": [predecessor]}).status_code == 400
    assert client.put(url, json={}).status_code == 400
    assert client.get("/api/tasks/item/999999/dependencies").status_code == 404
    assert client.put("/api/tasks/item/999999/dependencies", json={"dependency_ids": []}).status_code == 404


def test_direct_and_long_dependency_cycles_rejected(client, project):
    a = task(client, project, "A")
    b = task(client, project, "B", dependency_ids=[a])
    c = task(client, project, "C", dependency_ids=[b])
    for predecessor in (b, c):
        assert client.put(f"/api/tasks/item/{a}/dependencies", json={"dependency_ids": [predecessor]}).status_code == 400
    assert row(client, project, a)["dependency_ids"] == []
    assert row(client, project, c)["dependency_ids"] == [b]


def test_partial_edit_and_inline_changes_preserve_dependency_and_version_links(client, project, version, calendar):
    parent = task(client, project)
    predecessor = task(client, project)
    current = task(client, project, parent_id=parent, dependency_ids=[predecessor], version_ids=[version])
    assert client.put(f"/api/tasks/item/{current}", json={"title": "edited"}).status_code == 200
    client.patch(f"/api/tasks/item/{current}/priority", json={"priority": "紧急"})
    client.patch(f"/api/tasks/item/{current}/status", json={"status": "进行中"})
    result = row(client, project, current)
    assert (result["parent_id"], result["dependency_ids"], result["versions"], result["title"]) == (parent, [predecessor], ["v1.0"], "edited")
    assert result["dependency_blocked"] is True  # warning, not destructive status enforcement


def test_deleting_task_and_project_removes_both_edge_directions(client, project):
    a = task(client, project)
    b = task(client, project, dependency_ids=[a])
    c = task(client, project, dependency_ids=[b])
    assert client.delete(f"/api/tasks/item/{b}").status_code == 200
    assert row(client, project, c)["dependency_ids"] == []
    assert application.db.q("SELECT * FROM task_dependencies") == []
    task(client, project, dependency_ids=[a])
    assert client.delete(f"/api/projects/{project}").status_code == 200
    assert application.db.q("SELECT * FROM task_dependencies") == []


def test_concurrent_updates_cannot_create_dependency_cycle(client, project):
    a, b = task(client, project), task(client, project)
    barrier = Barrier(2)
    def change(pair):
        current, predecessor = pair
        barrier.wait(timeout=10)
        return client.put(f"/api/tasks/item/{current}/dependencies", json={"dependency_ids": [predecessor]}).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(change, [(a, b), (b, a)])) == [200, 400]
    assert len(application.db.q("SELECT * FROM task_dependencies")) == 1


def test_dependency_risk_propagation_and_completion(client, project, calendar):
    a = task(client, project, "late", due_date="2026-10-06")
    b = task(client, project, "intermediate", dependency_ids=[a], start_date="2026-10-07", due_date="2026-10-09")
    c = task(client, project, "downstream", dependency_ids=[b], start_date="2026-10-10", due_date="2026-10-15")
    assert row(client, project, b)["dependency_overdue"] is True
    assert row(client, project, c)["dependency_overdue"] is True
    client.patch(f"/api/tasks/item/{a}/status", json={"status": "已完成"})
    assert row(client, project, b)["dependency_blocked"] is False
    assert row(client, project, c)["dependency_overdue"] is False
    assert row(client, project, c)["dependency_blocked"] is True


def test_schedule_conflict_and_completed_tasks_no_longer_risky(client, project, calendar):
    a = task(client, project, due_date="2026-10-10")
    b = task(client, project, start_date="2026-10-10", dependency_ids=[a])
    assert row(client, project, b)["start_date"] == "2026-10-11"
    assert row(client, project, b)["schedule_conflict"] is False
    # Legacy/imported conflicts remain visible; new edits automatically prevent them.
    application.db.exec("UPDATE tasks SET start_date='2026-10-10' WHERE id=?", (b,))
    assert row(client, project, b)["schedule_conflict"] is True
    client.patch(f"/api/tasks/item/{b}/status", json={"status": "已完成"})
    result = row(client, project, b)
    assert not result["dependency_blocked"] and not result["dependency_risk"]


def test_dashboard_aggregate_is_weighted_and_scoped(client, project, calendar):
    other = client.post("/api/projects", json={"name": "另一个项目"}).json()["id"]
    late = task(client, project, "late", due_date="2026-10-06")
    task(client, project, "today", due_date="2026-10-07")
    task(client, project, "last upcoming", due_date="2026-10-14")
    task(client, project, "future", due_date="2026-10-15")
    task(client, project, "done", status="已完成")
    task(client, other, "dependent", dependency_ids=[], status="进行中")
    client.post(f"/api/issues/{project}", json={"title": "high risk", "severity": "高"})
    client.post(f"/api/issues/{other}", json={"title": "closed", "severity": "高", "status": "Closed"})
    for status in ("通过", "失败", "未执行", "阻塞"):
        client.post(f"/api/tests/{project}", json={"name": status, "status": status})
    version_id = client.post(f"/api/versions/{project}", json={"version": "v9"}).json()["id"]
    overall = client.get("/api/dashboard").json()
    single = client.get(f"/api/dashboard/{project}").json()
    assert overall["project_count"] == 2
    assert (overall["task_total"], overall["task_done"], overall["progress"]) == (6, 1, 17)
    assert (single["task_total"], single["progress"]) == (5, 20)
    assert (overall["overdue_count"], overall["due_soon_count"], overall["completed_this_week"]) == (1, 3, 1)
    assert overall["overdue_tasks"][0]["id"] == late
    assert overall["overdue_tasks"][0]["project_name"] == "机器人回归项目"
    assert overall["high_risk_issues"] == 1 and overall["test_pass_rate"] == 50
    assert sum(overall["status_distribution"].values()) == overall["task_total"]
    assert single["latest_version"]["id"] == version_id
    assert single["scope"] == "project" and overall["scope"] == "personal"
    assert overall["week_start"] == "2026-10-05" and overall["timezone"] == "UTC+8"
    assert all(value["project_id"] == project for value in single["pending"])


def test_dashboard_empty_missing_project_and_unknown_dates(client, calendar):
    empty = client.get("/api/dashboard").json()
    assert (empty["project_count"], empty["task_total"], empty["progress"], empty["test_pass_rate"]) == (0, 0, 0, None)
    assert empty["projects"] == []
    assert client.get("/api/dashboard/999999").status_code == 404
    project_id = client.post("/api/projects", json={"name": "empty"}).json()["id"]
    current = task(client, project_id)
    application.db.exec("UPDATE tasks SET due_date='bad-date' WHERE id=?", (current,))
    data = client.get(f"/api/dashboard/{project_id}").json()
    assert data["overdue_count"] == 0 and data["due_soon_count"] == 0


def test_dashboard_dependency_counters_and_ready_tasks(client, project, calendar):
    ready = task(client, project, due_date="2026-10-05")
    dependent = task(client, project, dependency_ids=[ready], start_date="2026-10-06")
    data = client.get(f"/api/dashboard/{project}").json()
    assert (data["dependency_blocked_count"], data["dependency_risk_count"]) == (1, 1)
    assert [value["id"] for value in data["ready_tasks"]] == [ready]
    assert data["dependency_risk_tasks"][0]["id"] == dependent


def test_completion_timestamp_idempotent_reopen_and_week_boundary(client, project, calendar, monkeypatch):
    current = task(client, project)
    url = f"/api/tasks/item/{current}/status"
    client.patch(url, json={"status": "已完成"})
    first = row(client, project, current)["completed_at"]
    assert client.get("/api/dashboard").json()["completed_this_week"] == 1
    monkeypatch.setattr(application, "now_text", lambda: "2026-10-07T15:00")
    client.patch(url, json={"status": "已完成"})
    assert row(client, project, current)["completed_at"] == first
    client.patch(url, json={"status": "待办"})
    assert row(client, project, current)["completed_at"] is None
    assert client.get("/api/dashboard").json()["completed_this_week"] == 0
    client.patch(url, json={"status": "已完成"})
    assert row(client, project, current)["completed_at"] == "2026-10-07T15:00"
    for stamp in (None, "2026-10-04T12:00", "2026-10-08T12:00", "bad-date"):
        application.db.exec("UPDATE tasks SET completed_at=? WHERE id=?", (stamp, current))
        assert client.get("/api/dashboard").json()["completed_this_week"] == 0
    application.db.exec("UPDATE tasks SET completed_at='2026-10-05T00:00' WHERE id=?", (current,))
    assert client.get("/api/dashboard").json()["completed_this_week"] == 1


def test_backup_includes_dependencies_and_completion_time(client, project, calendar):
    predecessor = task(client, project, status="已完成")
    dependent = task(client, project, dependency_ids=[predecessor])
    path = Path(client.post("/api/settings/backup").json()["path"])
    with sqlite3.connect(path) as connection:
        assert connection.execute("SELECT predecessor_id FROM task_dependencies WHERE task_id=?", (dependent,)).fetchone()[0] == predecessor
        assert connection.execute("SELECT completed_at FROM tasks WHERE id=?", (predecessor,)).fetchone()[0] == "2026-10-07T14:00"


def test_legacy_database_migrates_without_losing_data(tmp_path):
    path = tmp_path / "legacy.db"
    with sqlite3.connect(path) as connection:
        connection.executescript("""CREATE TABLE tasks(
          id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, parent_id INTEGER,
          milestone_id INTEGER, title TEXT NOT NULL, description TEXT DEFAULT '',owner TEXT DEFAULT '',
          status TEXT DEFAULT '待办',priority TEXT DEFAULT '中',start_date TEXT DEFAULT '',due_date TEXT DEFAULT '',
          estimate_hours REAL DEFAULT 0,actual_hours REAL DEFAULT 0);
          INSERT INTO tasks(project_id,title,status) VALUES(1,'旧任务','已完成');""")
    migrated = Database(path)
    assert migrated.one("SELECT * FROM tasks WHERE id=1")["title"] == "旧任务"
    assert migrated.one("SELECT * FROM tasks WHERE id=1")["completed_at"] is None
    assert migrated.q("SELECT * FROM task_dependencies") == []
    Database(path)  # Migration remains idempotent.
    assert migrated.one("SELECT COUNT(*) AS n FROM tasks")["n"] == 1
