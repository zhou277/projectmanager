"""Finish-to-start task dependencies, separate from parent/child hierarchy."""
from datetime import date
from fastapi import HTTPException


def parse_date(value):
    try:
        return date.fromisoformat(str(value))
    except (ValueError, TypeError):
        return None


def validate_dependencies(connection, project_id, task_id, values):
    if not isinstance(values, list):
        raise HTTPException(400, "前置任务必须是 ID 列表")
    ids = []
    for value in values:
        if isinstance(value, bool) or not isinstance(value, (str, int)) or not str(value).isdigit() or int(value) <= 0:
            raise HTTPException(400, "前置任务 ID 无效")
        value = int(value)
        if value not in ids:
            ids.append(value)
    rows = connection.execute("SELECT id FROM tasks WHERE project_id=?", (project_id,)).fetchall()
    allowed = {row["id"] for row in rows}
    if any(value not in allowed for value in ids):
        raise HTTPException(400, "前置任务不存在或不属于当前项目")
    if task_id in ids:
        raise HTTPException(400, "任务不能依赖自己")
    predecessors = {}
    for row in connection.execute("SELECT d.task_id,d.predecessor_id FROM task_dependencies d JOIN tasks t ON t.id=d.task_id WHERE t.project_id=?", (project_id,)):
        if row["task_id"] != task_id:
            predecessors.setdefault(row["task_id"], []).append(row["predecessor_id"])
    # New edges task -> predecessor create a cycle iff predecessor reaches task.
    for predecessor in ids:
        stack, visited = [predecessor], set()
        while stack:
            current = stack.pop()
            if current == task_id:
                raise HTTPException(400, "不能建立循环任务依赖")
            if current not in visited:
                visited.add(current)
                stack.extend(predecessors.get(current, []))
    return ids


def replace_dependencies(connection, task_id, ids):
    connection.execute("DELETE FROM task_dependencies WHERE task_id=?", (task_id,))
    connection.executemany("INSERT INTO task_dependencies(task_id,predecessor_id) VALUES(?,?)", [(task_id, value) for value in ids])


def enrich_dependencies(db, rows, today):
    """Bulk enrichment, including indirect predecessor delays; no per-edge queries."""
    if not rows:
        return rows
    by_id = {row["id"]: row for row in rows}
    local_numbers = {}
    counters = {}
    for row in sorted(rows, key=lambda item: item["id"]):
        pid = row["project_id"]
        counters[pid] = counters.get(pid, 0) + 1
        local_numbers[row["id"]] = counters[pid]
    links = db.q("SELECT task_id,predecessor_id FROM task_dependencies")
    graph = {}
    for link in links:
        if link["task_id"] in by_id and link["predecessor_id"] in by_id:
            graph.setdefault(link["task_id"], []).append(link["predecessor_id"])
    today = parse_date(today)
    for row in rows:
        ids = sorted(graph.get(row["id"], []))
        row["dependency_ids"] = ids
        row["predecessors"] = [{"id": value, "display_id": local_numbers[value], "title": by_id[value]["title"],
                                "status": by_id[value]["status"], "due_date": by_id[value]["due_date"]} for value in ids]
        unfinished = row["status"] != "已完成"
        row["dependency_blocked"] = unfinished and any(by_id[value]["status"] != "已完成" for value in ids)
        start = parse_date(row.get("start_date"))
        row["schedule_conflict"] = unfinished and any(start and parse_date(by_id[value].get("due_date")) and parse_date(by_id[value]["due_date"]) >= start for value in ids)
        stack, visited, delayed = list(ids), set(), False
        while stack:
            current = stack.pop()
            if current in visited:
                continue
            visited.add(current)
            predecessor = by_id[current]
            due = parse_date(predecessor.get("due_date"))
            delayed = delayed or (predecessor["status"] != "已完成" and due is not None and due < today)
            stack.extend(graph.get(current, []))
        row["dependency_overdue"] = unfinished and delayed
        row["dependency_risk"] = unfinished and (row["dependency_overdue"] or row["schedule_conflict"])
    return rows
