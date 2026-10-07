"""Shared project and single-user portfolio dashboard calculations."""
from datetime import timedelta
from task_dependencies import enrich_dependencies, parse_date


def dashboard_data(db, today, project_id=None):
    projects = db.q("SELECT * FROM projects ORDER BY id")
    if project_id is not None:
        projects = [project for project in projects if project["id"] == project_id]
    project_ids = {project["id"] for project in projects}
    tasks = [row for row in db.q("SELECT * FROM tasks ORDER BY id") if row["project_id"] in project_ids]
    issues = [row for row in db.q("SELECT * FROM issues ORDER BY id") if row["project_id"] in project_ids]
    tests = [row for row in db.q("SELECT * FROM tests ORDER BY id") if row["project_id"] in project_ids]
    versions = [row for row in db.q("SELECT * FROM versions ORDER BY id") if row["project_id"] in project_ids]
    enrich_dependencies(db, tasks, today)
    names = {project["id"]: project["name"] for project in projects}
    for rows in (tasks, issues):
        counts = {}
        for row in rows:
            pid = row["project_id"]
            counts[pid] = counts.get(pid, 0) + 1
            row["display_id"] = counts[pid]
            row["project_name"] = names[pid]
    # Query links in batches; preserve existing dashboard version chips.
    for rows, table, field in ((tasks, "task_versions", "task_id"), (issues, "issue_versions", "issue_id")):
        links = {}
        for link in db.q(f"SELECT r.{field} AS entity_id,v.version FROM {table} r JOIN versions v ON v.id=r.version_id ORDER BY v.id"):
            links.setdefault(link["entity_id"], []).append(link["version"])
        for row in rows:
            row["versions"] = links.get(row["id"], [])
    day = parse_date(today)
    week_start = day - timedelta(days=day.weekday())

    def completed_this_week(task):
        completion = parse_date(str(task.get("completed_at") or "")[:10])
        return completion is not None and week_start <= completion <= day

    def summarize(selected_tasks, selected_issues, selected_tests):
        pending = [task for task in selected_tasks if task["status"] != "已完成"]
        completed = [task for task in selected_tasks if task["status"] == "已完成"]
        overdue = [task for task in pending if parse_date(task["due_date"]) and parse_date(task["due_date"]) < day]
        upcoming = [task for task in pending if parse_date(task["due_date"]) and day <= parse_date(task["due_date"]) <= day + timedelta(days=7)]
        risky = [issue for issue in selected_issues if issue["status"] not in ("Closed", "Resolved") and issue["severity"] in ("高", "紧急")]
        passed = sum(test["status"] == "通过" for test in selected_tests)
        failed = sum(test["status"] == "失败" for test in selected_tests)
        distribution = {status: sum(task["status"] == status for task in selected_tasks) for status in ("待办", "进行中", "阻塞", "已完成")}
        distribution["待办"] += sum(task["status"] == "未开始" for task in selected_tasks)
        other = len(selected_tasks) - sum(distribution.values())
        if other:
            distribution["其他"] = other
        total = len(selected_tasks)
        return {"task_total": total, "task_done": len(completed), "progress": round(len(completed) / total * 100) if total else 0,
                "in_progress": distribution["进行中"], "overdue_count": len(overdue), "due_soon_count": len(upcoming),
                "dependency_blocked_count": sum(task["dependency_blocked"] for task in pending),
                "dependency_risk_count": sum(task["dependency_risk"] for task in pending),
                "completed_this_week": sum(completed_this_week(task) for task in completed),
                "open_issues": sum(issue["status"] not in ("Closed", "Resolved") for issue in selected_issues),
                "high_risk_issues": len(risky), "tests_passed": passed, "tests_failed": failed,
                "test_pass_rate": round(passed / (passed + failed) * 100) if passed + failed else None,
                "status_distribution": distribution, "pending": pending, "completed": completed, "risky_issues": risky,
                "overdue_tasks": sorted(overdue, key=lambda task: task["due_date"]),
                "due_soon_tasks": sorted(upcoming, key=lambda task: task["due_date"]),
                "dependency_risk_tasks": [task for task in pending if task["dependency_risk"]],
                "ready_tasks": [task for task in pending if task["status"] in ("待办", "未开始") and not task["dependency_blocked"]]}

    overall = summarize(tasks, issues, tests)
    summaries = []
    for project in projects:
        pid = project["id"]
        summary = summarize([row for row in tasks if row["project_id"] == pid], [row for row in issues if row["project_id"] == pid], [row for row in tests if row["project_id"] == pid])
        latest = next((version for version in reversed(versions) if version["project_id"] == pid), None)
        summaries.append({**project, **{key: value for key, value in summary.items() if not isinstance(value, (list, dict))}, "latest_version": latest})
    return {**overall, "scope": "project" if project_id is not None else "personal", "today": today, "timezone": "UTC+8",
            "week_start": week_start.isoformat(), "project_count": len(projects), "projects": summaries,
            "latest_version": summaries[0]["latest_version"] if len(summaries) == 1 else None}
