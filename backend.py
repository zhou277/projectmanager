import sqlite3
from pathlib import Path
from datetime import datetime, timedelta, timezone

UTC8 = timezone(timedelta(hours=8))

def now_text():
    return datetime.now(UTC8).strftime("%Y-%m-%dT%H:%M")

def today_text():
    return datetime.now(UTC8).strftime("%Y-%m-%d")

class Database:
    def __init__(self, path: Path):
        self.path = path
        self.init_db()
        self.ensure_compatibility()

    def connect(self):
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        return conn

    def q(self, sql, params=()):
        with self.connect() as c:
            return [dict(r) for r in c.execute(sql, params).fetchall()]

    def one(self, sql, params=()):
        rows = self.q(sql, params)
        return rows[0] if rows else None

    def exec(self, sql, params=()):
        with self.connect() as c:
            cur = c.execute(sql, params)
            c.commit()
            return cur.lastrowid

    def table_columns(self, table):
        with self.connect() as c:
            return {r["name"] for r in c.execute(f"PRAGMA table_info({table})")}

    def ensure_column(self, table, name, declaration):
        if name not in self.table_columns(table):
            self.exec(f"ALTER TABLE {table} ADD COLUMN {name} {declaration}")

    def init_db(self):
        with self.connect() as c:
            c.executescript("""
            CREATE TABLE IF NOT EXISTS projects(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                owner TEXT DEFAULT '',
                description TEXT DEFAULT '',
                start_date TEXT DEFAULT '',
                target_date TEXT DEFAULT '',
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS daily_logs(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                log_date TEXT NOT NULL UNIQUE,
                planned TEXT NOT NULL DEFAULT '',
                actual TEXT NOT NULL DEFAULT '',
                progress INTEGER NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),
                revision INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS daily_log_items(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                log_id INTEGER NOT NULL,
                entity_kind TEXT NOT NULL CHECK(entity_kind IN ('task','issue')),
                entity_id INTEGER NOT NULL,
                project_id INTEGER NOT NULL,
                project_name TEXT NOT NULL,
                display_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                snapshot_status TEXT NOT NULL,
                progress INTEGER NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),
                result TEXT NOT NULL DEFAULT '',
                ordinal INTEGER NOT NULL DEFAULT 0,
                UNIQUE(log_id,entity_kind,entity_id)
            );
            CREATE INDEX IF NOT EXISTS idx_daily_log_items_log ON daily_log_items(log_id);
            CREATE TABLE IF NOT EXISTS tasks(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                parent_id INTEGER,
                milestone_id INTEGER,
                title TEXT NOT NULL,
                description TEXT DEFAULT '',
                owner TEXT DEFAULT '',
                status TEXT DEFAULT '待办',
                priority TEXT DEFAULT '中',
                start_date TEXT DEFAULT '',
                due_date TEXT DEFAULT '',
                estimate_hours REAL DEFAULT 0,
                actual_hours REAL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS milestones(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                description TEXT DEFAULT '',
                target_date TEXT DEFAULT '',
                status TEXT DEFAULT '未开始'
            );
            CREATE TABLE IF NOT EXISTS tags(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                name TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS task_tags(
                task_id INTEGER NOT NULL,
                tag_id INTEGER NOT NULL,
                PRIMARY KEY(task_id, tag_id)
            );
            CREATE TABLE IF NOT EXISTS tests(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                task_id INTEGER,
                name TEXT NOT NULL,
                category TEXT DEFAULT '',
                environment TEXT DEFAULT '',
                software_version TEXT DEFAULT '',
                steps TEXT DEFAULT '',
                expected TEXT DEFAULT '',
                actual TEXT DEFAULT '',
                status TEXT DEFAULT '未执行',
                tester TEXT DEFAULT '',
                executed_at TEXT DEFAULT '',
                notes TEXT DEFAULT ''
            );
            CREATE TABLE IF NOT EXISTS issues(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                related_task_id INTEGER,
                title TEXT NOT NULL,
                issue_type TEXT DEFAULT 'Bug',
                severity TEXT DEFAULT '中',
                status TEXT DEFAULT 'Open',
                assignee TEXT DEFAULT '',
                software_version TEXT DEFAULT '',
                description TEXT DEFAULT '',
                root_cause TEXT DEFAULT '',
                solution TEXT DEFAULT '',
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                closed_at TEXT
            );
            CREATE TABLE IF NOT EXISTS test_issues(
                test_id INTEGER NOT NULL,
                issue_id INTEGER NOT NULL,
                PRIMARY KEY(test_id, issue_id)
            );
            CREATE TABLE IF NOT EXISTS dev_logs(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                log_date TEXT DEFAULT '',
                summary TEXT DEFAULT '',
                details TEXT DEFAULT '',
                blockers TEXT DEFAULT '',
                next_steps TEXT DEFAULT '',
                author TEXT DEFAULT ''
            );
            CREATE TABLE IF NOT EXISTS dev_overviews(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                content TEXT DEFAULT '',
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS git_refs(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                repo TEXT DEFAULT '',
                branch TEXT DEFAULT '',
                commit_hash TEXT DEFAULT '',
                message TEXT DEFAULT '',
                author TEXT DEFAULT '',
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS ros_artifacts(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                artifact_type TEXT DEFAULT '',
                robot_name TEXT DEFAULT '',
                path TEXT DEFAULT '',
                description TEXT DEFAULT '',
                recorded_at TEXT DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS versions(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL,
                category TEXT NOT NULL DEFAULT '软件',
                component TEXT NOT NULL DEFAULT 'Software',
                version TEXT DEFAULT '',
                revision TEXT DEFAULT '',
                serial_or_image TEXT DEFAULT '',
                notes TEXT DEFAULT '',
                branch TEXT DEFAULT '',
                recorded_at TEXT DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS task_versions(
                task_id INTEGER NOT NULL,
                version_id INTEGER NOT NULL,
                PRIMARY KEY(task_id, version_id)
            );
            CREATE TABLE IF NOT EXISTS task_dependencies(
                task_id INTEGER NOT NULL,
                predecessor_id INTEGER NOT NULL,
                PRIMARY KEY(task_id, predecessor_id),
                CHECK(task_id != predecessor_id)
            );
            CREATE INDEX IF NOT EXISTS idx_task_dependencies_predecessor
                ON task_dependencies(predecessor_id);
            CREATE TABLE IF NOT EXISTS issue_versions(
                issue_id INTEGER NOT NULL,
                version_id INTEGER NOT NULL,
                PRIMARY KEY(issue_id, version_id)
            );
            CREATE TABLE IF NOT EXISTS test_versions(
                test_id INTEGER NOT NULL,
                version_id INTEGER NOT NULL,
                PRIMARY KEY(test_id, version_id)
            );
            """)

    def ensure_compatibility(self):
        self.ensure_column("daily_logs", "tomorrow", "TEXT DEFAULT ''")
        self.ensure_column("tasks", "completed_at", "TEXT")
        self.ensure_column("tests", "software_version", "TEXT DEFAULT ''")
        self.ensure_column("issues", "software_version", "TEXT DEFAULT ''")
        self.ensure_column("versions", "branch", "TEXT DEFAULT ''")

    def project_local_map(self, table, project_id):
        rows = self.q(f"SELECT id FROM {table} WHERE project_id=? ORDER BY id", (project_id,))
        return {r["id"]: i + 1 for i, r in enumerate(rows)}

    def versions_for_entity(self, relation_table, entity_field, entity_id):
        return self.q(
            f"""SELECT v.id,v.version,v.notes
                FROM versions v
                JOIN {relation_table} r ON r.version_id=v.id
                WHERE r.{entity_field}=?
                ORDER BY v.id""",
            (entity_id,)
        )

    def replace_version_links(self, relation_table, entity_field, entity_id, version_ids):
        with self.connect() as c:
            c.execute(f"DELETE FROM {relation_table} WHERE {entity_field}=?", (entity_id,))
            for vid in version_ids:
                c.execute(
                    f"INSERT OR IGNORE INTO {relation_table}({entity_field},version_id) VALUES(?,?)",
                    (entity_id, int(vid))
                )
            c.commit()

    def delete_project(self, project_id):
        with self.connect() as c:
            task_ids = [r["id"] for r in c.execute("SELECT id FROM tasks WHERE project_id=?", (project_id,))]
            test_ids = [r["id"] for r in c.execute("SELECT id FROM tests WHERE project_id=?", (project_id,))]
            issue_ids = [r["id"] for r in c.execute("SELECT id FROM issues WHERE project_id=?", (project_id,))]
            version_ids = [r["id"] for r in c.execute("SELECT id FROM versions WHERE project_id=?", (project_id,))]

            if task_ids:
                q = ",".join("?" * len(task_ids))
                c.execute(f"DELETE FROM task_dependencies WHERE task_id IN ({q}) OR predecessor_id IN ({q})", task_ids + task_ids)
                c.execute(f"DELETE FROM task_tags WHERE task_id IN ({q})", task_ids)
                c.execute(f"DELETE FROM task_versions WHERE task_id IN ({q})", task_ids)
            if test_ids:
                q = ",".join("?" * len(test_ids))
                c.execute(f"DELETE FROM test_issues WHERE test_id IN ({q})", test_ids)
                c.execute(f"DELETE FROM test_versions WHERE test_id IN ({q})", test_ids)
            if issue_ids:
                q = ",".join("?" * len(issue_ids))
                c.execute(f"DELETE FROM test_issues WHERE issue_id IN ({q})", issue_ids)
                c.execute(f"DELETE FROM issue_versions WHERE issue_id IN ({q})", issue_ids)
            if version_ids:
                q = ",".join("?" * len(version_ids))
                c.execute(f"DELETE FROM task_versions WHERE version_id IN ({q})", version_ids)
                c.execute(f"DELETE FROM issue_versions WHERE version_id IN ({q})", version_ids)
                c.execute(f"DELETE FROM test_versions WHERE version_id IN ({q})", version_ids)

            for table in ["tasks","milestones","tags","tests","issues","dev_logs","dev_overviews","git_refs","ros_artifacts","versions"]:
                c.execute(f"DELETE FROM {table} WHERE project_id=?", (project_id,))
            c.execute("DELETE FROM projects WHERE id=?", (project_id,))
            c.commit()
