from pathlib import Path
import sqlite3

import pytest

from backend import Database
from conftest import application


def create_item(client, project, kind="task", **fields):
    route = "tasks" if kind == "task" else "issues"
    return client.post(f"/api/{route}/{project}", json={"title": "每日事项", **fields}).json()["id"]


def payload(**fields):
    return {"revision": 0, "planned": "今日计划", "actual": "实际完成", "progress": 35, "items": [], **fields}


def test_draft_create_edit_and_date_uniqueness(client):
    url = "/api/daily-logs/2026-10-09"
    draft = client.get(url).json()
    assert draft["id"] is None and draft["revision"] == 0 and draft["items"] == []
    saved = client.put(url, json=payload()).json()
    assert saved["revision"] == 1 and saved["progress"] == 35
    response = client.put(url, json=payload(revision=1, actual="更新实际工作", progress=100))
    assert response.status_code == 200
    assert response.json()["id"] == saved["id"] and response.json()["revision"] == 2
    assert client.get(url).json()["actual"] == "更新实际工作"
    assert len(client.get("/api/daily-logs").json()) == 1


def test_cross_project_task_and_issue_selection_and_progress_independence(client, project):
    other = client.post("/api/projects", json={"name": "另一项目"}).json()["id"]
    task = create_item(client, project, title="任务甲")
    issue = create_item(client, other, "issue", title="问题乙")
    items = [{"entity_kind": "task", "entity_id": task, "progress": 80, "result": "当天结果"},
             {"entity_kind": "issue", "entity_id": issue, "progress": 20}]
    response = client.put("/api/daily-logs/2026-10-09", json=payload(items=items))
    assert response.status_code == 200
    saved = response.json()
    assert [item["project_name"] for item in saved["items"]] == ["机器人回归项目", "另一项目"]
    assert [item["title"] for item in saved["items"]] == ["任务甲", "问题乙"]
    assert [item["progress"] for item in saved["items"]] == [80, 20]
    assert client.get(f"/api/tasks/{project}").json()[0]["status"] == "待办"
    assert client.get(f"/api/issues/{other}").json()[0]["status"] == "Open"


def test_available_only_contains_unfinished_work_and_keeps_project_local_ids(client, project):
    create_item(client, project, status="已完成")
    open_task = create_item(client, project, title="子任务", parent_id=None)
    for status in ("Closed", "Resolved"):
        create_item(client, project, "issue", status=status)
    open_issue = create_item(client, project, "issue", status="Blocked")
    data = client.get("/api/daily-logs/available").json()
    assert data["today"]
    items = data["projects"][0]["items"]
    assert [(row["entity_kind"], row["entity_id"], row["display_id"]) for row in items] == [("task", open_task, 2), ("issue", open_issue, 3)]


def test_archive_groups_year_month_and_filters(client):
    for day in ("2025-12-31", "2026-01-01", "2026-10-08", "2026-10-09"):
        assert client.put(f"/api/daily-logs/{day}", json=payload(actual=day)).status_code == 200
    archive = client.get("/api/daily-logs/archive").json()["years"]
    assert [(year["year"], year["count"]) for year in archive] == [(2026, 3), (2025, 1)]
    assert [(month["month"], month["count"]) for month in archive[0]["months"]] == [(10, 2), (1, 1)]
    assert [day["log_date"] for day in archive[0]["months"][0]["days"]] == ["2026-10-09", "2026-10-08"]
    assert len(client.get("/api/daily-logs?year=2026").json()) == 3
    assert len(client.get("/api/daily-logs?year=2026&month=10").json()) == 2
    assert client.get("/api/daily-logs?month=10").status_code == 400
    assert client.get("/api/daily-logs?year=2026&month=13").status_code == 422


def test_snapshot_survives_rename_completion_and_project_deletion(client, project):
    task = create_item(client, project, title="原始任务")
    item = {"entity_kind": "task", "entity_id": task, "progress": 30}
    url = "/api/daily-logs/2026-10-09"
    assert client.put(url, json=payload(items=[item])).status_code == 200
    client.put(f"/api/tasks/item/{task}", json={"title": "新名称"})
    client.patch(f"/api/tasks/item/{task}/status", json={"status": "已完成"})
    client.delete(f"/api/projects/{project}")
    response = client.put(url, json=payload(revision=1, items=[{**item, "progress": 100, "title": "伪造标题"}]))
    assert response.status_code == 200
    snapshot = response.json()["items"][0]
    assert (snapshot["title"], snapshot["project_name"], snapshot["snapshot_status"], snapshot["progress"]) == ("原始任务", "机器人回归项目", "待办", 100)
    assert client.get("/api/daily-logs/available").json()["projects"] == []


def test_same_item_can_have_independent_daily_progress(client, project):
    task = create_item(client, project)
    for day, progress in (("2026-10-08", 40), ("2026-10-09", 85)):
        client.put(f"/api/daily-logs/{day}", json=payload(items=[{"entity_kind": "task", "entity_id": task, "progress": progress}]))
    assert client.get("/api/daily-logs/2026-10-08").json()["items"][0]["progress"] == 40
    assert client.get("/api/daily-logs/2026-10-09").json()["items"][0]["progress"] == 85


@pytest.mark.parametrize("day", ["bad-date", "2026-02-30", "2026-13-01", "20261009", "2026-1-1"])
def test_invalid_dates_rejected(client, day):
    assert client.get(f"/api/daily-logs/{day}").status_code == 400
    assert client.put(f"/api/daily-logs/{day}", json=payload()).status_code == 400


@pytest.mark.parametrize("progress", [-1, 101, 2.5, True, "50", None])
def test_invalid_overall_progress_rejected(client, progress):
    assert client.put("/api/daily-logs/2026-10-09", json=payload(progress=progress)).status_code == 400
    assert client.get("/api/daily-logs").json() == []


@pytest.mark.parametrize("item", [{"entity_kind": "task", "entity_id": True}, {"entity_kind": "other", "entity_id": 1},
                                 {"entity_kind": "task", "entity_id": 99999}, "bad"])
def test_bad_items_fail_atomically(client, item):
    assert client.put("/api/daily-logs/2026-10-09", json=payload(items=[item])).status_code == 400
    assert application.db.q("SELECT * FROM daily_logs") == []


def test_completed_missing_duplicate_and_invalid_item_progress_rejected(client, project):
    task = create_item(client, project)
    item = {"entity_kind": "task", "entity_id": task}
    url = "/api/daily-logs/2026-10-09"
    assert client.put(url, json=payload(items=[item, item])).status_code == 400
    assert client.put(url, json=payload(items=[{**item, "progress": 101}])).status_code == 400
    client.patch(f"/api/tasks/item/{task}/status", json={"status": "已完成"})
    assert client.put(url, json=payload(items=[item])).status_code == 400
    assert client.get("/api/daily-logs").json() == []


def test_stale_revision_protects_saved_log(client):
    url = "/api/daily-logs/2026-10-09"
    client.put(url, json=payload())
    assert client.put(url, json=payload(actual="stale edit")).status_code == 409
    assert client.get(url).json()["actual"] == "实际完成"
    assert client.put(url, json={"actual": "missing revision"}).status_code == 400


def test_remove_selected_item_and_reorder(client, project):
    a,b = create_item(client, project),create_item(client, project)
    items = [{"entity_kind":"task","entity_id":a},{"entity_kind":"task","entity_id":b}]
    url = "/api/daily-logs/2026-10-09"
    client.put(url, json=payload(items=items))
    saved = client.put(url, json=payload(revision=1, items=items[::-1])).json()
    assert [item["entity_id"] for item in saved["items"]] == [b,a]
    saved = client.put(url, json=payload(revision=2,items=[items[0]])).json()
    assert [item["entity_id"] for item in saved["items"]] == [a]


def test_backup_contains_daily_journal_and_item_snapshot(client, project):
    task = create_item(client, project)
    client.put("/api/daily-logs/2026-10-09", json=payload(items=[{"entity_kind":"task","entity_id":task,"progress":55}]))
    backup = Path(client.post("/api/settings/backup").json()["path"])
    with sqlite3.connect(backup) as connection:
        assert connection.execute("SELECT planned FROM daily_logs").fetchone()[0] == "今日计划"
        assert connection.execute("SELECT progress FROM daily_log_items").fetchone()[0] == 55


def test_existing_database_migration_is_additive(tmp_path):
    db = Database(tmp_path / "old.db")
    db.exec("INSERT INTO projects(name) VALUES('旧项目')")
    db.exec("DROP TABLE daily_log_items")
    db.exec("DROP TABLE daily_logs")
    Database(db.path)
    assert db.one("SELECT name FROM projects")["name"] == "旧项目"
    assert db.q("SELECT * FROM daily_logs") == []
