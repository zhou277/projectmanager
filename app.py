import sys
import os
import time
import threading
import webbrowser
import traceback
import socket
import uuid
import json
import sqlite3
from pathlib import Path
from threading import Lock

from fastapi import FastAPI, HTTPException, Body, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
import uvicorn

from backend import Database, now_text, today_text
from task_schedule import default_task_day, schedule_task
from dashboard import dashboard_data
from daily_logs import make_daily_router
from task_dependencies import validate_dependencies, replace_dependencies, enrich_dependencies

APP_NAME = "projectmanager"
APP_VERSION = "3.25.0"
HOST = "127.0.0.1"
PREFERRED_PORT = 7000

def app_dir():
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent

def log_path():
    return app_dir() / "projectmanager.log"

def setup_logging_streams():
    """Redirect hidden-window stdout/stderr into a real log file."""
    log_file = open(log_path(), "a", encoding="utf-8", buffering=1)
    if sys.stdout is None:
        sys.stdout = log_file
    if sys.stderr is None:
        sys.stderr = log_file
    return log_file

def find_available_port(start=PREFERRED_PORT, attempts=20):
    for port in range(start, start + attempts):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind((HOST, port))
                return port
            except OSError:
                continue
    raise RuntimeError("没有可用的本地端口")

def wait_for_server(port, timeout=15.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(0.4)
            try:
                if s.connect_ex((HOST, port)) == 0:
                    return True
            except OSError:
                pass
        time.sleep(0.2)
    return False

BASE = app_dir()
DATA_DIR = Path(os.environ.get("PROJECTMANAGER_DATA_DIR", str(BASE))).resolve()
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "robot_project_manager.db"
SETTINGS_PATH = DATA_DIR / "projectmanager_settings.json"
STATIC_DIR = Path(getattr(sys, "_MEIPASS", BASE)) / "static"

DEFAULT_SETTINGS = {
    "theme": "dark",
    "preferred_port": 7000,
    "auto_backup": False,
    "backup_dir": "backups",
    "backup_keep": 10
}

def load_settings():
    data = dict(DEFAULT_SETTINGS)
    try:
        if SETTINGS_PATH.exists():
            saved = json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
            if isinstance(saved, dict):
                data.update(saved)
    except Exception:
        traceback.print_exc(file=sys.stderr)

    # Normalize / guard values.
    data["theme"] = "light" if data.get("theme") == "light" else "dark"
    try:
        port = int(data.get("preferred_port", 7000))
    except (TypeError, ValueError):
        port = 7000
    data["preferred_port"] = min(65535, max(1024, port))
    data["auto_backup"] = bool(data.get("auto_backup", False))
    data["backup_dir"] = str(data.get("backup_dir") or "backups")
    try:
        keep = int(data.get("backup_keep", 10))
    except (TypeError, ValueError):
        keep = 10
    data["backup_keep"] = min(100, max(1, keep))
    return data

def save_settings(data):
    normalized = dict(DEFAULT_SETTINGS)
    normalized.update(data or {})
    normalized["theme"] = "light" if normalized.get("theme") == "light" else "dark"
    normalized["preferred_port"] = min(65535, max(1024, int(normalized.get("preferred_port", 7000))))
    normalized["auto_backup"] = bool(normalized.get("auto_backup", False))
    normalized["backup_dir"] = str(normalized.get("backup_dir") or "backups").strip() or "backups"
    normalized["backup_keep"] = min(100, max(1, int(normalized.get("backup_keep", 10))))
    SETTINGS_PATH.write_text(
        json.dumps(normalized, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )
    return normalized

def resolved_backup_dir(settings=None):
    settings = settings or load_settings()
    raw = Path(settings["backup_dir"]).expanduser()
    return raw if raw.is_absolute() else DATA_DIR / raw

def create_database_backup():
    settings = load_settings()
    target_dir = resolved_backup_dir(settings)
    target_dir.mkdir(parents=True, exist_ok=True)

    stamp = time.strftime("%Y%m%d_%H%M%S")
    target = target_dir / f"robot_project_manager_{stamp}.db"

    src_conn = sqlite3.connect(DB_PATH)
    dst_conn = sqlite3.connect(target)
    try:
        src_conn.backup(dst_conn)
    finally:
        dst_conn.close()
        src_conn.close()

    backups = sorted(
        target_dir.glob("robot_project_manager_*.db"),
        key=lambda p: p.stat().st_mtime,
        reverse=True
    )
    for old in backups[settings["backup_keep"]:]:
        try:
            old.unlink()
        except OSError:
            pass

    return target

def maybe_auto_backup():
    settings = load_settings()
    if settings.get("auto_backup") and DB_PATH.exists():
        try:
            path = create_database_backup()
            print("Auto backup:", path)
        except Exception:
            traceback.print_exc(file=sys.stderr)

db = Database(DB_PATH)
app = FastAPI(title=APP_NAME)
SERVER_INSTANCE = None
CURRENT_PORT = None
CLIENTS = {}
CLIENT_LOCK = Lock()
TASK_WRITE_LOCK = Lock()
app.include_router(make_daily_router(lambda: db, lambda: today_text(), lambda: now_text(), TASK_WRITE_LOCK))
EVER_HAD_CLIENT = False
NO_CLIENT_SINCE = None
CLIENT_STALE_SECONDS = 1800.0
CLIENT_GRACE_SECONDS = 1.0
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

@app.get("/", response_class=HTMLResponse)
def index():
    return (STATIC_DIR / "index.html").read_text(encoding="utf-8")

@app.get("/api/settings")
def get_settings():
    s = load_settings()
    return {
        **s,
        "database_path": str(DB_PATH),
        "log_path": str(log_path()),
        "settings_path": str(SETTINGS_PATH),
        "resolved_backup_dir": str(resolved_backup_dir(s)),
        "timezone": "UTC+8",
        "current_port": CURRENT_PORT
    }

@app.put("/api/settings")
def update_settings(payload: dict = Body(...)):
    current = load_settings()
    allowed = {"theme", "preferred_port", "auto_backup", "backup_dir", "backup_keep"}
    for key in allowed:
        if key in payload:
            current[key] = payload[key]
    try:
        saved = save_settings(current)
    except (TypeError, ValueError):
        raise HTTPException(400, "设置值无效")
    return {
        **saved,
        "database_path": str(DB_PATH),
        "log_path": str(log_path()),
        "settings_path": str(SETTINGS_PATH),
        "resolved_backup_dir": str(resolved_backup_dir(saved)),
        "timezone": "UTC+8",
        "current_port": CURRENT_PORT,
        "restart_required": saved["preferred_port"] != CURRENT_PORT
    }

@app.post("/api/settings/backup")
def backup_now(request: Request):
    client_host = request.client.host if request.client else ""
    if client_host not in ("127.0.0.1", "::1"):
        raise HTTPException(403, "仅允许本机备份")
    try:
        target = create_database_backup()
        return {"ok": True, "path": str(target)}
    except Exception as exc:
        raise HTTPException(500, f"备份失败: {exc}")

@app.get("/api/about")
def about():
    settings = load_settings()
    return {
        "name": APP_NAME,
        "version": APP_VERSION,
        "runtime": "Windows EXE" if getattr(sys, "frozen", False) else "Python source",
        "python": sys.version.split()[0],
        "database_path": str(DB_PATH),
        "log_path": str(log_path()),
        "settings_path": str(SETTINGS_PATH),
        "preferred_port": settings["preferred_port"],
        "current_port": CURRENT_PORT,
        "timezone": "UTC+8",
        "release_notes": [
            "左侧统一个人 Dashboard、项目、每日日志导航，上方工具栏按当前页面显示",
            "新增独立每日日志：每日计划、实际工作与进度",
            "支持跨项目拖拽/勾选任务与 Issue，按年月归档并保留历史快照",
            "新增多前置任务依赖与循环校验、等待/延期风险提示、甘特图依赖箭头",
            "新增个人整体 Dashboard，增强各项目 Dashboard 与跨项目任务跳转",
            "前端按职责模块化，保持现有 UI 与业务功能",
            "新增 Python API 回归测试与 Node 前端回归检查",
            "修复深色模式状态下拉菜单可读性",
            "新增设置页面与持久化配置",
            "新增数据库手动/启动自动备份",
            "新增版本信息页面",
            "任务与 Issue 的软件版本改为下拉选择",
            "甘特图改为按月份展示，并保留历史日期、今天标记与横向滚动",
            "修复任务、Issue、软件版本的行选择与双击编辑",
            "Branch 列完整显示并调整软件版本表格宽度",
            "任务状态排序调整为进行中优先",
            "任务优先级支持表格内下拉修改",
            "暂时关闭报告生成功能"
        ]
    }

@app.get("/api/projects")
def get_projects():
    return db.q("SELECT * FROM projects ORDER BY id")

@app.post("/api/projects")
def create_project(p: dict = Body(...)):
    name = (p.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "项目名称不能为空")
    pid = db.exec(
        """INSERT INTO projects(name,owner,description,start_date,target_date,created_at)
           VALUES(?,?,?,?,?,?)""",
        (name,p.get("owner",""),p.get("description",""),p.get("start_date") or today_text(),p.get("target_date",""),now_text())
    )
    return {"id":pid}

@app.put("/api/projects/{pid}")
def update_project(pid:int,p:dict=Body(...)):
    db.exec("UPDATE projects SET name=?,owner=?,description=?,start_date=?,target_date=? WHERE id=?",
            (p.get("name",""),p.get("owner",""),p.get("description",""),p.get("start_date",""),p.get("target_date",""),pid))
    return {"ok":True}

@app.delete("/api/projects/{pid}")
def delete_project(pid:int):
    with TASK_WRITE_LOCK:
        db.delete_project(pid)
    return {"ok":True}

def entity_versions(table, field, eid):
    return [x["version"] for x in db.versions_for_entity(table,field,eid)]

@app.get("/api/dashboard")
def personal_dashboard():
    return dashboard_data(db, today_text())

@app.get("/api/dashboard/{pid}")
def dashboard(pid:int):
    if not db.one("SELECT id FROM projects WHERE id=?", (pid,)):
        raise HTTPException(404, "项目不存在")
    return dashboard_data(db, today_text(), pid)

@app.get("/api/tasks/{pid}")
def get_tasks(pid:int, sort:str="status"):
    rows=db.q("SELECT * FROM tasks WHERE project_id=?",(pid,))
    nums=db.project_local_map("tasks",pid)
    so={"进行中":0,"待办":1,"未开始":1,"阻塞":2,"已完成":3}
    po={"紧急":0,"高":1,"中":2,"低":3}
    for r in rows:
        r["display_id"]=nums.get(r["id"],0)
        r["versions"]=entity_versions("task_versions","task_id",r["id"])
    if sort=="priority":
        rows.sort(key=lambda x:(po.get(x["priority"],9),so.get(x["status"],9),x["due_date"] or "9999"))
    elif sort=="version":
        def version_key(x):
            items = sorted(v.strip().lower() for v in (x.get("versions") or []) if v and v.strip())
            return (1, "") if not items else (0, " | ".join(items))
        rows.sort(key=lambda x:(version_key(x),so.get(x["status"],9),po.get(x["priority"],9),x["id"]))
    else:
        rows.sort(key=lambda x:(so.get(x["status"],9),po.get(x["priority"],9),x["due_date"] or "9999"))
    return enrich_dependencies(db, rows, today_text())


def normalize_parent_id(value):
    if value in (None, "", 0, "0"):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        raise HTTPException(400, "父任务 ID 无效")

def validate_task_parent(project_id: int, task_id, parent_id):
    """Ensure parent belongs to this project and does not create a cycle."""
    parent_id = normalize_parent_id(parent_id)
    if parent_id is None:
        return None

    parent = db.one("SELECT id,project_id,parent_id FROM tasks WHERE id=?", (parent_id,))
    if not parent or parent["project_id"] != project_id:
        raise HTTPException(400, "父任务不存在或不属于当前项目")

    if task_id is not None and parent_id == task_id:
        raise HTTPException(400, "任务不能把自己设为父任务")

    if task_id is not None:
        seen = set()
        current = parent_id
        while current is not None:
            if current == task_id:
                raise HTTPException(400, "不能建立循环父子任务关系")
            if current in seen:
                raise HTTPException(400, "检测到异常的任务父子循环")
            seen.add(current)
            row = db.one("SELECT parent_id FROM tasks WHERE id=?", (current,))
            if not row:
                break
            current = row["parent_id"]

    return parent_id

def replace_task_versions(connection, task_id, version_ids):
    connection.execute("DELETE FROM task_versions WHERE task_id=?", (task_id,))
    for version_id in version_ids:
        connection.execute("INSERT OR IGNORE INTO task_versions(task_id,version_id) VALUES(?,?)", (task_id, int(version_id)))

def task_completion_time(old_status, new_status, old_completed_at):
    if new_status != "已完成":
        return None
    return old_completed_at if old_status == "已完成" else now_text()

@app.post("/api/tasks/{pid}")
def create_task(pid:int,p:dict=Body(...)):
    title=(p.get("title") or "").strip()
    if not title:
        raise HTTPException(400,"任务标题不能为空")
    with TASK_WRITE_LOCK, db.connect() as connection:
        if not connection.execute("SELECT id FROM projects WHERE id=?", (pid,)).fetchone():
            raise HTTPException(404, "项目不存在")
        parent_id=validate_task_parent(pid,None,p.get("parent_id"))
        dependencies=validate_dependencies(connection,pid,None,p.get("dependency_ids",[]))
        status=p.get("status","待办")
        default_day = default_task_day(connection,pid,parent_id,today_text()) if not p.get("start_date") else p["start_date"]
        tid=connection.execute("""INSERT INTO tasks(project_id,parent_id,milestone_id,title,description,owner,status,priority,start_date,due_date,completed_at)
                   VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
                (pid,parent_id,None,title,p.get("description",""),"",status,p.get("priority","中"),
                 p.get("start_date") or default_day,p.get("due_date") or default_day,task_completion_time(None,status,None))).lastrowid
        replace_dependencies(connection,tid,dependencies)
        replace_task_versions(connection,tid,p.get("version_ids",[]))
        schedule_task(connection,pid,tid)
    return {"id":tid}

@app.put("/api/tasks/item/{tid}")
def update_task(tid:int,p:dict=Body(...)):
    with TASK_WRITE_LOCK, db.connect() as connection:
        row=connection.execute("SELECT * FROM tasks WHERE id=?",(tid,)).fetchone()
        if not row:
            raise HTTPException(404,"任务不存在")
        parent_id=validate_task_parent(row["project_id"],tid,p.get("parent_id",row["parent_id"]))
        dependencies=None
        if "dependency_ids" in p:
            dependencies=validate_dependencies(connection,row["project_id"],tid,p["dependency_ids"])
        title=(p.get("title",row["title"]) or "").strip()
        if not title:
            raise HTTPException(400,"任务标题不能为空")
        status=p.get("status",row["status"])
        completed_at=task_completion_time(row["status"],status,row["completed_at"])
        connection.execute("""UPDATE tasks SET parent_id=?,title=?,description=?,status=?,priority=?,start_date=?,due_date=?,completed_at=? WHERE id=?""",
            (parent_id,title,p.get("description",row["description"]),status,p.get("priority",row["priority"]),
             p.get("start_date",row["start_date"]),p.get("due_date",row["due_date"]),completed_at,tid))
        if dependencies is not None:
            replace_dependencies(connection,tid,dependencies)
        if "version_ids" in p:
            replace_task_versions(connection,tid,p["version_ids"])
        schedule_task(connection,row["project_id"],tid)
    return {"ok":True}

@app.get("/api/tasks/item/{tid}/dependencies")
def get_task_dependencies(tid:int):
    row=db.one("SELECT * FROM tasks WHERE id=?",(tid,))
    if not row:
        raise HTTPException(404,"任务不存在")
    rows=enrich_dependencies(db,db.q("SELECT * FROM tasks WHERE project_id=?",(row["project_id"],)),today_text())
    task=next(task for task in rows if task["id"]==tid)
    return {key:task[key] for key in ("dependency_ids","predecessors","dependency_blocked","dependency_risk","dependency_overdue","schedule_conflict")}

@app.put("/api/tasks/item/{tid}/dependencies")
def update_task_dependencies(tid:int,p:dict=Body(...)):
    with TASK_WRITE_LOCK, db.connect() as connection:
        row=connection.execute("SELECT project_id FROM tasks WHERE id=?",(tid,)).fetchone()
        if not row:
            raise HTTPException(404,"任务不存在")
        if "dependency_ids" not in p:
            raise HTTPException(400,"缺少前置任务列表")
        ids=validate_dependencies(connection,row["project_id"],tid,p["dependency_ids"])
        replace_dependencies(connection,tid,ids)
        schedule_task(connection,row["project_id"],tid)
    return {"ok":True,"dependency_ids":ids}

@app.patch("/api/tasks/item/{tid}/status")
def update_task_status(tid:int,p:dict=Body(...)):
    with TASK_WRITE_LOCK, db.connect() as connection:
        row=connection.execute("SELECT * FROM tasks WHERE id=?",(tid,)).fetchone()
        if not row:
            raise HTTPException(404,"任务不存在")
        status=p.get("status")
        if status not in ("待办","进行中","阻塞","已完成"):
            raise HTTPException(400,"无效的任务状态")
        completed_at=task_completion_time(row["status"],status,row["completed_at"])
        connection.execute("UPDATE tasks SET status=?,completed_at=? WHERE id=?",(status,completed_at,tid))
    return {"ok":True,"status":status}

@app.patch("/api/tasks/item/{tid}/priority")
def update_task_priority(tid:int,p:dict=Body(...)):
    row=db.one("SELECT id,priority FROM tasks WHERE id=?",(tid,))
    if not row:
        raise HTTPException(404,"任务不存在")
    priority=p.get("priority")
    allowed=("低","中","高","紧急")
    if priority not in allowed:
        raise HTTPException(400,"无效的任务优先级")
    db.exec("UPDATE tasks SET priority=? WHERE id=?",(priority,tid))
    return {"ok":True,"priority":priority}

@app.delete("/api/tasks/item/{tid}")
def delete_task(tid:int):
    with TASK_WRITE_LOCK, db.connect() as connection:
        connection.execute("DELETE FROM task_dependencies WHERE task_id=? OR predecessor_id=?",(tid,tid))
        connection.execute("DELETE FROM task_versions WHERE task_id=?",(tid,))
        connection.execute("DELETE FROM task_tags WHERE task_id=?",(tid,))
        connection.execute("UPDATE tasks SET parent_id=NULL WHERE parent_id=?",(tid,))
        connection.execute("DELETE FROM tasks WHERE id=?",(tid,))
    return {"ok":True}

@app.get("/api/issues/{pid}")
def get_issues(pid:int):
    rows=db.q("SELECT * FROM issues WHERE project_id=? ORDER BY id DESC",(pid,))
    nums=db.project_local_map("issues",pid)
    for r in rows:
        r["display_id"]=nums.get(r["id"],0)
        r["versions"]=entity_versions("issue_versions","issue_id",r["id"])
    return rows

@app.post("/api/issues/{pid}")
def create_issue(pid:int,p:dict=Body(...)):
    iid=db.exec("""INSERT INTO issues(project_id,related_task_id,title,issue_type,severity,status,assignee,description,root_cause,solution,created_at)
                   VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
                (pid,p.get("related_task_id"),p.get("title",""),p.get("issue_type","Bug"),p.get("severity","中"),p.get("status","Open"),
                 p.get("assignee",""),p.get("description",""),p.get("root_cause",""),p.get("solution",""),now_text()))
    db.replace_version_links("issue_versions","issue_id",iid,p.get("version_ids",[]))
    return {"id":iid}

@app.put("/api/issues/item/{iid}")
def update_issue(iid:int,p:dict=Body(...)):
    row=db.one("SELECT * FROM issues WHERE id=?",(iid,))
    if not row: raise HTTPException(404,"Issue 不存在")
    status=p.get("status",row["status"]); closed=now_text() if status in ("Closed","Resolved") else None
    db.exec("""UPDATE issues SET related_task_id=?,title=?,issue_type=?,severity=?,status=?,assignee=?,description=?,root_cause=?,solution=?,closed_at=? WHERE id=?""",
            (p.get("related_task_id"),p.get("title",row["title"]),p.get("issue_type",row["issue_type"]),p.get("severity",row["severity"]),
             status,p.get("assignee",row["assignee"]),p.get("description",row["description"]),p.get("root_cause",row["root_cause"]),
             p.get("solution",row["solution"]),closed,iid))
    db.replace_version_links("issue_versions","issue_id",iid,p.get("version_ids",[]))
    return {"ok":True}

@app.patch("/api/issues/item/{iid}/status")
def update_issue_status(iid:int,p:dict=Body(...)):
    row=db.one("SELECT id,status FROM issues WHERE id=?",(iid,))
    if not row:
        raise HTTPException(404,"Issue 不存在")
    status=p.get("status")
    allowed=("Open","In Progress","Blocked","Resolved","Closed")
    if status not in allowed:
        raise HTTPException(400,"无效的 Issue 状态")
    closed=now_text() if status in ("Closed","Resolved") else None
    db.exec("UPDATE issues SET status=?,closed_at=? WHERE id=?",(status,closed,iid))
    return {"ok":True,"status":status}

@app.delete("/api/issues/item/{iid}")
def delete_issue(iid:int):
    db.exec("DELETE FROM test_issues WHERE issue_id=?",(iid,))
    db.exec("DELETE FROM issue_versions WHERE issue_id=?",(iid,))
    db.exec("DELETE FROM issues WHERE id=?",(iid,))
    return {"ok":True}

@app.get("/api/tests/{pid}")
def get_tests(pid:int):
    rows=db.q("SELECT * FROM tests WHERE project_id=? ORDER BY id DESC",(pid,))
    nums=db.project_local_map("tests",pid)
    for r in rows:
        r["display_id"]=nums.get(r["id"],0)
        r["versions"]=entity_versions("test_versions","test_id",r["id"])
    return rows

@app.post("/api/tests/{pid}")
def create_test(pid:int,p:dict=Body(...)):
    tid=db.exec("""INSERT INTO tests(project_id,task_id,name,category,environment,steps,expected,actual,status,tester,executed_at,notes)
                   VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
                (pid,p.get("task_id"),p.get("name",""),p.get("category","集成测试"),p.get("environment",""),p.get("steps",""),
                 p.get("expected",""),p.get("actual",""),p.get("status","未执行"),p.get("tester",""),now_text(),p.get("notes","")))
    db.replace_version_links("test_versions","test_id",tid,p.get("version_ids",[]))
    return {"id":tid}

@app.put("/api/tests/item/{tid}")
def update_test(tid:int,p:dict=Body(...)):
    row=db.one("SELECT * FROM tests WHERE id=?",(tid,))
    if not row: raise HTTPException(404,"测试不存在")
    db.exec("""UPDATE tests SET task_id=?,name=?,category=?,environment=?,steps=?,expected=?,actual=?,status=?,tester=?,executed_at=?,notes=? WHERE id=?""",
            (p.get("task_id"),p.get("name",row["name"]),p.get("category",row["category"]),p.get("environment",row["environment"]),
             p.get("steps",row["steps"]),p.get("expected",row["expected"]),p.get("actual",row["actual"]),p.get("status",row["status"]),
             p.get("tester",row["tester"]),now_text(),p.get("notes",row["notes"]),tid))
    db.replace_version_links("test_versions","test_id",tid,p.get("version_ids",[]))
    return {"ok":True}

@app.delete("/api/tests/item/{tid}")
def delete_test(tid:int):
    db.exec("DELETE FROM test_versions WHERE test_id=?",(tid,))
    db.exec("DELETE FROM test_issues WHERE test_id=?",(tid,))
    db.exec("DELETE FROM tests WHERE id=?",(tid,))
    return {"ok":True}

@app.get("/api/versions/{pid}")
def get_versions(pid:int):
    rows=db.q("SELECT * FROM versions WHERE project_id=? ORDER BY id",(pid,))
    nums=db.project_local_map("versions",pid)
    for r in rows:r["display_id"]=nums.get(r["id"],0)
    return rows

@app.post("/api/versions/{pid}")
def create_version(pid:int,p:dict=Body(...)):
    vid=db.exec("""INSERT INTO versions(project_id,category,component,version,revision,serial_or_image,notes,branch,recorded_at)
                   VALUES(?,?,?,?,?,?,?,?,?)""",
                (pid,"软件","Software",p.get("version",""),"","",p.get("notes",""),p.get("branch",""),now_text()))
    return {"id":vid}

@app.put("/api/versions/item/{vid}")
def update_version(vid:int,p:dict=Body(...)):
    db.exec("UPDATE versions SET version=?,branch=?,notes=? WHERE id=?",
            (p.get("version",""),p.get("branch",""),p.get("notes",""),vid))
    return {"ok":True}

@app.delete("/api/versions/item/{vid}")
def delete_version(vid:int):
    db.exec("DELETE FROM task_versions WHERE version_id=?",(vid,))
    db.exec("DELETE FROM issue_versions WHERE version_id=?",(vid,))
    db.exec("DELETE FROM test_versions WHERE version_id=?",(vid,))
    db.exec("DELETE FROM versions WHERE id=?",(vid,))
    return {"ok":True}

@app.get("/api/dev-overviews/{pid}")
def get_dev_overviews(pid:int):
    return db.q("SELECT * FROM dev_overviews WHERE project_id=? ORDER BY id DESC",(pid,))

@app.post("/api/dev-overviews/{pid}")
def create_dev_overview(pid:int,p:dict=Body(...)):
    title=(p.get("title") or "").strip()
    if not title:
        raise HTTPException(400,"标题不能为空")
    rid=db.exec("""INSERT INTO dev_overviews(project_id,title,content,updated_at) VALUES(?,?,?,?)""",
                (pid,title,p.get("content",""),now_text()))
    return {"id":rid}

@app.put("/api/dev-overviews/item/{rid}")
def update_dev_overview(rid:int,p:dict=Body(...)):
    row=db.one("SELECT * FROM dev_overviews WHERE id=?",(rid,))
    if not row:
        raise HTTPException(404,"研发事项不存在")
    db.exec("UPDATE dev_overviews SET title=?,content=?,updated_at=? WHERE id=?",
            (p.get("title",row["title"]),p.get("content",row["content"]),now_text(),rid))
    return {"ok":True}

@app.delete("/api/dev-overviews/item/{rid}")
def delete_dev_overview(rid:int):
    db.exec("DELETE FROM dev_overviews WHERE id=?",(rid,))
    return {"ok":True}

@app.get("/api/logs/{pid}")
def get_logs(pid:int):
    return {
        "dev_logs":db.q("SELECT * FROM dev_logs WHERE project_id=? ORDER BY log_date DESC,id DESC",(pid,)),
        "git_refs":db.q("SELECT * FROM git_refs WHERE project_id=? ORDER BY id DESC",(pid,)),
        "ros_artifacts":db.q("SELECT * FROM ros_artifacts WHERE project_id=? ORDER BY id DESC",(pid,))
    }

@app.post("/api/devlogs/{pid}")
def create_devlog(pid:int,p:dict=Body(...)):
    return {"id":db.exec("""INSERT INTO dev_logs(project_id,log_date,summary,details,blockers,next_steps,author) VALUES(?,?,?,?,?,?,?)""",
                         (pid,p.get("log_date") or today_text(),p.get("summary",""),p.get("details",""),p.get("blockers",""),p.get("next_steps",""),p.get("author","")))}

@app.put("/api/devlogs/item/{rid}")
def update_devlog(rid:int,p:dict=Body(...)):
    row=db.one("SELECT * FROM dev_logs WHERE id=?",(rid,))
    if not row: raise HTTPException(404,"研发日志不存在")
    db.exec("""UPDATE dev_logs SET log_date=?,summary=?,details=?,blockers=?,next_steps=?,author=? WHERE id=?""",
            (p.get("log_date",row["log_date"]),p.get("summary",row["summary"]),p.get("details",row["details"]),
             p.get("blockers",row["blockers"]),p.get("next_steps",row["next_steps"]),p.get("author",row["author"]),rid))
    return {"ok":True}

@app.post("/api/git/{pid}")
def create_git(pid:int,p:dict=Body(...)):
    return {"id":db.exec("""INSERT INTO git_refs(project_id,repo,branch,commit_hash,message,author,created_at) VALUES(?,?,?,?,?,?,?)""",
                         (pid,p.get("repo",""),p.get("branch",""),p.get("commit_hash",""),p.get("message",""),p.get("author",""),now_text()))}

@app.put("/api/git/item/{rid}")
def update_git(rid:int,p:dict=Body(...)):
    row=db.one("SELECT * FROM git_refs WHERE id=?",(rid,))
    if not row: raise HTTPException(404,"Git 记录不存在")
    db.exec("""UPDATE git_refs SET repo=?,branch=?,commit_hash=?,message=?,author=? WHERE id=?""",
            (p.get("repo",row["repo"]),p.get("branch",row["branch"]),p.get("commit_hash",row["commit_hash"]),
             p.get("message",row["message"]),p.get("author",row["author"]),rid))
    return {"ok":True}

@app.post("/api/ros/{pid}")
def create_ros(pid:int,p:dict=Body(...)):
    return {"id":db.exec("""INSERT INTO ros_artifacts(project_id,artifact_type,robot_name,path,description,recorded_at) VALUES(?,?,?,?,?,?)""",
                         (pid,p.get("message_type",""),p.get("example",""),p.get("topic_name",""),p.get("description",""),now_text()))}

@app.put("/api/ros/item/{rid}")
def update_ros(rid:int,p:dict=Body(...)):
    row=db.one("SELECT * FROM ros_artifacts WHERE id=?",(rid,))
    if not row: raise HTTPException(404,"ROS Topic 记录不存在")
    db.exec("""UPDATE ros_artifacts SET artifact_type=?,robot_name=?,path=?,description=? WHERE id=?""",
            (p.get("message_type",row["artifact_type"]),p.get("example",row["robot_name"]),
             p.get("topic_name",row["path"]),p.get("description",row["description"]),rid))
    return {"ok":True}


def _touch_client(token: str):
    global EVER_HAD_CLIENT, NO_CLIENT_SINCE
    now = time.time()
    with CLIENT_LOCK:
        CLIENTS[token] = now
        EVER_HAD_CLIENT = True
        NO_CLIENT_SINCE = None

def _remove_client(token: str):
    global NO_CLIENT_SINCE
    with CLIENT_LOCK:
        CLIENTS.pop(token, None)
        if EVER_HAD_CLIENT and not CLIENTS and NO_CLIENT_SINCE is None:
            NO_CLIENT_SINCE = time.time()

@app.post("/api/client/register")
def register_client(payload: dict = Body(...)):
    token = str(payload.get("token") or "").strip()
    if not token:
        raise HTTPException(400, "缺少客户端 token")
    _touch_client(token)
    return {"ok": True}

@app.post("/api/client/heartbeat")
def heartbeat_client(payload: dict = Body(...)):
    token = str(payload.get("token") or "").strip()
    if not token:
        raise HTTPException(400, "缺少客户端 token")
    _touch_client(token)
    return {"ok": True}

@app.post("/api/client/close")
def close_client(payload: dict = Body(...)):
    token = str(payload.get("token") or "").strip()
    if token:
        _remove_client(token)
    return {"ok": True}

def client_monitor_loop():
    """Stop after the last browser page explicitly closes.

    Normal tab/background switching must never be treated as a close. Browser
    timers are heavily throttled in background tabs, so heartbeat expiry is
    only a very long crash-recovery fallback.
    """
    global NO_CLIENT_SINCE
    while True:
        time.sleep(0.2)

        server = SERVER_INSTANCE
        if server is not None and server.should_exit:
            return

        now = time.time()
        with CLIENT_LOCK:
            # Very long fallback only for crashed/abandoned browsers. This is
            # intentionally NOT used for ordinary close detection.
            stale = [token for token, last_seen in CLIENTS.items()
                     if now - last_seen > CLIENT_STALE_SECONDS]
            for token in stale:
                CLIENTS.pop(token, None)

            if EVER_HAD_CLIENT:
                if CLIENTS:
                    NO_CLIENT_SINCE = None
                elif NO_CLIENT_SINCE is None:
                    NO_CLIENT_SINCE = now
                elif now - NO_CLIENT_SINCE >= CLIENT_GRACE_SECONDS:
                    if SERVER_INSTANCE is not None:
                        print("No active browser pages; shutting down projectmanager.")
                        SERVER_INSTANCE.should_exit = True
                    return

@app.post("/api/shutdown")
def shutdown_app(request: Request):
    # Security: shutdown is only allowed from this machine.
    client_host = request.client.host if request.client else ""
    if client_host not in ("127.0.0.1", "::1"):
        raise HTTPException(403, "仅允许本机退出软件")

    global SERVER_INSTANCE
    if SERVER_INSTANCE is None:
        raise HTTPException(503, "服务实例尚未就绪")

    # DB operations in this project commit per mutation, so no pending
    # application transaction needs to be flushed here.
    def stop_server():
        time.sleep(0.15)
        SERVER_INSTANCE.should_exit = True

    threading.Thread(target=stop_server, daemon=True).start()
    return {"ok": True, "message": "projectmanager is shutting down"}


def open_browser_when_ready(port):
    if wait_for_server(port):
        webbrowser.open(f"http://{HOST}:{port}")

def run_server(port):
    global SERVER_INSTANCE
    config = uvicorn.Config(
        app,
        host=HOST,
        port=port,
        log_config=None,
        access_log=False,
        log_level="critical",
    )
    SERVER_INSTANCE = uvicorn.Server(config)
    SERVER_INSTANCE.run()

def main():
    global CURRENT_PORT
    log_file = setup_logging_streams()
    threading.Thread(target=client_monitor_loop, daemon=True).start()
    try:
        print("\n=== projectmanager start ===")
        print("Executable:", sys.executable)
        print("App dir:", app_dir())
        print("Database:", DB_PATH)
        print("Static dir:", STATIC_DIR)

        if not STATIC_DIR.exists():
            raise RuntimeError(f"静态资源目录不存在: {STATIC_DIR}")
        if not (STATIC_DIR / "index.html").exists():
            raise RuntimeError(f"找不到网页入口: {STATIC_DIR / 'index.html'}")

        maybe_auto_backup()
        settings = load_settings()
        port = find_available_port(start=settings["preferred_port"])
        CURRENT_PORT = port
        print("Preferred port:", settings["preferred_port"])
        print("Using port:", port)

        threading.Thread(
            target=open_browser_when_ready,
            args=(port,),
            daemon=True,
        ).start()

        run_server(port)
    except Exception:
        traceback.print_exc(file=sys.stderr)
        try:
            log_file.flush()
        except Exception:
            pass
        raise


if __name__=="__main__":
    main()
