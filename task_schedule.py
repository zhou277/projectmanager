"""Atomic finish-to-start scheduling and expansion of ancestor date ranges."""
from collections import deque
from datetime import date, timedelta
from fastapi import HTTPException


def day(value):
    try:
        parsed = date.fromisoformat(str(value))
        return parsed if parsed.isoformat() == value else None
    except (ValueError, TypeError):
        return None


def next_day(value):
    try:
        return value + timedelta(days=1)
    except OverflowError:
        raise HTTPException(400, "日期超出支持范围，请调整前置任务日期")


def default_task_day(connection, project_id, parent_id, today):
    rows = connection.execute("SELECT due_date FROM tasks WHERE project_id=? AND parent_id IS ?", (project_id, parent_id))
    ends = [parsed for row in rows if (parsed := day(row["due_date"]))]
    parent = connection.execute("SELECT start_date FROM tasks WHERE id=?", (parent_id,)).fetchone() if parent_id else None
    lower = max(day(today), day(parent["start_date"]) or day(today)) if parent else day(today)
    return max(lower, next_day(max(ends))).isoformat() if ends else lower.isoformat()


def schedule_task(connection, project_id, task_id):
    rows = {row["id"]: dict(row) for row in connection.execute("SELECT * FROM tasks WHERE project_id=?", (project_id,))}
    children_by_parent = {}
    for key, row in rows.items():
        children_by_parent.setdefault(row["parent_id"], []).append(key)
    predecessors, successors = {}, {}
    for link in connection.execute("SELECT d.* FROM task_dependencies d JOIN tasks t ON t.id=d.task_id WHERE t.project_id=?", (project_id,)):
        if link["predecessor_id"] not in rows:
            continue  # Do not let dangling legacy links break an unrelated edit.
        predecessors.setdefault(link["task_id"], []).append(link["predecessor_id"])
        successors.setdefault(link["predecessor_id"], []).append(link["task_id"])
    for key in predecessors:
        descendants, stack = set(), [key]
        while stack:
            ancestor = stack.pop()
            for child_id in children_by_parent.get(ancestor, []):
                if child_id not in descendants:
                    descendants.add(child_id)
                    stack.append(child_id)
        if descendants:
            visited, stack = set(), list(predecessors.get(key, []))
            while stack:
                predecessor = stack.pop()
                if predecessor in descendants:
                    raise HTTPException(400, "父任务不能直接或间接依赖自己的子任务，日期约束无法同时满足")
                if predecessor not in visited:
                    visited.add(predecessor)
                    stack.extend(predecessors.get(predecessor, []))
    # A parent's end must contain its children; a child cannot start after its own parent's end.
    edges = {key: list(successors.get(key, [])) for key in rows}
    for key, row in rows.items():
        if row["parent_id"] in rows:
            edges[key].append(row["parent_id"])
    indegree = dict.fromkeys(rows, 0)
    for values in edges.values():
        for key in values:
            indegree[key] += 1
    ready = deque(key for key, value in indegree.items() if value == 0)
    count = 0
    while ready:
        count += 1
        for key in edges[ready.popleft()]:
            indegree[key] -= 1
            if not indegree[key]:
                ready.append(key)
    if count != len(rows):
        raise HTTPException(400, "前置任务与父子层级形成日期循环，请调整依赖关系")
    queue, pending = deque([task_id]), {task_id}
    steps = 0
    while queue:
        key = queue.popleft()
        pending.remove(key)
        row = rows[key]
        start, end = day(row["start_date"]), day(row["due_date"])
        if not start or not end:
            if key == task_id:
                raise HTTPException(400, "任务日期应为有效的 YYYY-MM-DD")
            continue  # Leave unrelated legacy date strings intact.
        end = max(start, end)
        ends = [parsed for value in predecessors.get(key, []) if (parsed := day(rows[value]["due_date"]))]
        if ends and start <= max(ends):
            shifted = next_day(max(ends))
            try:
                end += shifted - start
                # Move early children along with a delayed parent, preserving duration.
                children_queue = deque([(key, shifted)])
                while children_queue:
                    ancestor, earliest = children_queue.popleft()
                    for child_id in children_by_parent.get(ancestor, []):
                        child = rows[child_id]
                        child_start, child_end = day(child["start_date"]), day(child["due_date"])
                        if child["parent_id"] == ancestor and child_start and child_end and child_start < earliest:
                            child["start_date"] = earliest.isoformat()
                            child["due_date"] = (max(child_start, child_end) + (earliest - child_start)).isoformat()
                            connection.execute("UPDATE tasks SET start_date=?,due_date=? WHERE id=?", (child["start_date"], child["due_date"], child["id"]))
                            children_queue.append((child["id"], earliest))
                            for target in [child["id"], *successors.get(child["id"], [])]:
                                if target not in pending:
                                    queue.append(target)
                                    pending.add(target)
            except OverflowError:
                raise HTTPException(400, "顺延后的日期超出支持范围")
            start = shifted
        children = [rows[child_id] for child_id in children_by_parent.get(key, [])]
        starts = [parsed for child in children if (parsed := day(child["start_date"]))]
        ends = [parsed for child in children if (parsed := day(child["due_date"]))]
        start = min([start, *starts])
        end = max([end, *ends])
        changed = (row["start_date"], row["due_date"]) != (start.isoformat(), end.isoformat())
        if changed:
            row["start_date"], row["due_date"] = start.isoformat(), end.isoformat()
            connection.execute("UPDATE tasks SET start_date=?,due_date=? WHERE id=?", (row["start_date"], row["due_date"], key))
        if changed or key == task_id:
            for target in [row["parent_id"], *successors.get(key, [])]:
                if target in rows and target not in pending:
                    queue.append(target)
                    pending.add(target)
        steps += 1
        if steps > max(20, len(rows) ** 2 * 2):
            raise HTTPException(400, "任务日期约束无法同时满足，请调整父子任务与依赖关系")
