"""Personal daily journal, with historical snapshots of cross-project work."""
from datetime import date
from threading import Lock
from fastapi import APIRouter, Body, HTTPException, Query


def valid_day(value):
    try:
        parsed = date.fromisoformat(value)
        if parsed.isoformat() != value:
            raise ValueError
        return value
    except (ValueError, TypeError):
        raise HTTPException(400, "日期应为有效的 YYYY-MM-DD")


def percent(value):
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 100:
        raise HTTPException(400, "进度应为 0 到 100 的整数")
    return value


def text_field(payload, name):
    value = payload.get(name, "")
    if not isinstance(value, str) or len(value) > 50000:
        raise HTTPException(400, "日志内容应为文本，且不超过 50000 字符")
    return value


def make_daily_router(get_db, today_text, now_text, mutation_lock):
    router = APIRouter(prefix="/api/daily-logs")
    journal_lock = Lock()

    def read_log(day):
        db = get_db()
        record = db.one("SELECT * FROM daily_logs WHERE log_date=?", (day,))
        if not record:
            return {"id": None, "log_date": day, "planned": "", "actual": "", "tomorrow": "", "progress": 0, "revision": 0, "items": []}
        record["items"] = db.q("SELECT * FROM daily_log_items WHERE log_id=? ORDER BY ordinal,id", (record["id"],))
        return record

    @router.get("/available")
    def available():
        db = get_db()
        projects = db.q("SELECT id,name FROM projects ORDER BY id")
        groups = {p["id"]: {"id": p["id"], "name": p["name"], "items": []} for p in projects}
        for table, kind, closed in (("tasks", "task", ("已完成",)), ("issues", "issue", ("Closed", "Resolved"))):
            counts = {}
            for row in db.q(f"SELECT * FROM {table} ORDER BY id"):
                pid = row["project_id"]
                counts[pid] = counts.get(pid, 0) + 1
                if pid not in groups or row["status"] in closed:
                    continue
                groups[pid]["items"].append({"entity_kind": kind, "entity_id": row["id"], "project_id": pid,
                    "project_name": groups[pid]["name"], "display_id": counts[pid], "title": row["title"],
                    "snapshot_status": row["status"], "priority": row.get("priority", row.get("severity", "")),
                    "due_date": row.get("due_date", "")})
        return {"today": today_text(), "projects": list(groups.values())}

    @router.get("/archive")
    def archive():
        rows = get_db().q("SELECT log_date,progress,planned,actual,tomorrow,updated_at FROM daily_logs ORDER BY log_date DESC")
        years = {}
        for row in rows:
            year, month = int(row["log_date"][:4]), int(row["log_date"][5:7])
            months = years.setdefault(year, {})
            months.setdefault(month, []).append({"log_date": row["log_date"], "progress": row["progress"],
                "summary": (row["actual"] or row["planned"] or row["tomorrow"])[:100], "updated_at": row["updated_at"]})
        return {"years": [{"year": year, "count": sum(len(days) for days in months.values()),
                           "months": [{"month": month, "count": len(days), "days": days} for month, days in months.items()]}
                          for year, months in years.items()]}

    @router.get("")
    def list_logs(year: int | None = Query(None, ge=1, le=9999), month: int | None = Query(None, ge=1, le=12)):
        if month is not None and year is None:
            raise HTTPException(400, "按月份查询时请同时提供年份")
        where, params = "", []
        if year is not None:
            prefix = f"{year:04d}" + (f"-{month:02d}" if month is not None else "")
            where, params = "WHERE log_date LIKE ?", [prefix + "%"]
        return get_db().q(f"SELECT log_date,planned,actual,tomorrow,progress,revision,updated_at FROM daily_logs {where} ORDER BY log_date DESC", params)

    @router.get("/{day}")
    def get_log(day: str):
        return read_log(valid_day(day))

    @router.put("/{day}")
    def save_log(day: str, payload: dict = Body(...)):
        day = valid_day(day)
        progress = percent(payload.get("progress", 0))
        planned, actual = text_field(payload, "planned"), text_field(payload, "actual")
        revision = payload.get("revision")
        if isinstance(revision, bool) or not isinstance(revision, int) or revision < 0:
            raise HTTPException(400, "缺少有效日志修订号，请重新加载当天日志")
        items = payload.get("items", [])
        if not isinstance(items, list) or len(items) > 500:
            raise HTTPException(400, "事项列表无效，最多 500 条")
        db = get_db()
        # Serialize against task/project mutations, preserve snapshots if sources disappear.
        with mutation_lock, journal_lock, db.connect() as connection:
            existing = connection.execute("SELECT * FROM daily_logs WHERE log_date=?", (day,)).fetchone()
            tomorrow = text_field(payload, "tomorrow") if "tomorrow" in payload else (existing["tomorrow"] if existing else "")
            current_revision = existing["revision"] if existing else 0
            if revision != current_revision:
                raise HTTPException(409, "当天日志已在其他页面更新，请保留当前内容后重新加载")
            snapshots = {}
            if existing:
                snapshots = {(row["entity_kind"], row["entity_id"]): dict(row) for row in connection.execute("SELECT * FROM daily_log_items WHERE log_id=?", (existing["id"],))}
            normalized, seen = [], set()
            for ordinal, item in enumerate(items):
                if not isinstance(item, dict):
                    raise HTTPException(400, "事项格式无效")
                kind, entity_id = item.get("entity_kind"), item.get("entity_id")
                if kind not in ("task", "issue") or isinstance(entity_id, bool) or not isinstance(entity_id, int) or entity_id <= 0:
                    raise HTTPException(400, "事项类型或 ID 无效")
                key = (kind, entity_id)
                if key in seen:
                    raise HTTPException(400, "不能重复添加同一事项")
                seen.add(key)
                snapshot = snapshots.get(key)
                if snapshot is None:
                    table = "tasks" if kind == "task" else "issues"
                    source = connection.execute(f"SELECT e.*,p.name AS project_name FROM {table} e JOIN projects p ON p.id=e.project_id WHERE e.id=?", (entity_id,)).fetchone()
                    closed = ("已完成",) if kind == "task" else ("Closed", "Resolved")
                    if not source or source["status"] in closed:
                        raise HTTPException(400, "新加入的事项已完成或不存在，请刷新未完成事项列表")
                    display_id = connection.execute(f"SELECT COUNT(*) FROM {table} WHERE project_id=? AND id<=?", (source["project_id"], entity_id)).fetchone()[0]
                    snapshot = {"project_id": source["project_id"], "project_name": source["project_name"], "display_id": display_id,
                                "title": source["title"], "snapshot_status": source["status"]}
                normalized.append((kind, entity_id, snapshot["project_id"], snapshot["project_name"], snapshot["display_id"],
                    snapshot["title"], snapshot["snapshot_status"], percent(item.get("progress", 0)), text_field(item, "result"), ordinal))
            stamp = now_text()
            if existing:
                log_id = existing["id"]
                connection.execute("UPDATE daily_logs SET planned=?,actual=?,tomorrow=?,progress=?,revision=revision+1,updated_at=? WHERE id=?", (planned, actual, tomorrow, progress, stamp, log_id))
            else:
                log_id = connection.execute("INSERT INTO daily_logs(log_date,planned,actual,tomorrow,progress,created_at,updated_at) VALUES(?,?,?,?,?,?,?)", (day, planned, actual, tomorrow, progress, stamp, stamp)).lastrowid
            connection.execute("DELETE FROM daily_log_items WHERE log_id=?", (log_id,))
            connection.executemany("INSERT INTO daily_log_items(log_id,entity_kind,entity_id,project_id,project_name,display_id,title,snapshot_status,progress,result,ordinal) VALUES(?,?,?,?,?,?,?,?,?,?,?)", [(log_id, *item) for item in normalized])
            result = dict(connection.execute("SELECT * FROM daily_logs WHERE id=?", (log_id,)).fetchone())
            result["items"] = [dict(row) for row in connection.execute("SELECT * FROM daily_log_items WHERE log_id=? ORDER BY ordinal,id", (log_id,))]
            return result

    return router
