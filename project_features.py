"""Persistent project ordering and validated Issue/test relationships."""
from fastapi import HTTPException


def validate_ids(values, label):
    if not isinstance(values, list) or len(values) > 1000:
        raise HTTPException(400, f"{label}应为 ID 列表，最多 1000 项")
    result = []
    for value in values:
        if isinstance(value, bool) or not isinstance(value, (int, str)) or not str(value).isdigit() or int(value) <= 0:
            raise HTTPException(400, f"{label} ID 无效")
        key = int(value)
        if key not in result:
            result.append(key)
    return result


def validate_issue_tests(connection, project_id, values):
    ids = validate_ids(values, "关联测试")
    allowed = {row["id"] for row in connection.execute("SELECT id FROM tests WHERE project_id=?", (project_id,))}
    if any(key not in allowed for key in ids):
        raise HTTPException(400, "关联测试不存在或不属于当前项目")
    return ids


def replace_issue_tests(connection, issue_id, ids):
    connection.execute("DELETE FROM test_issues WHERE issue_id=?", (issue_id,))
    connection.executemany("INSERT INTO test_issues(test_id,issue_id) VALUES(?,?)", [(key, issue_id) for key in ids])


def linked_tests(db, project_id, issue_id):
    numbers = db.project_local_map("tests", project_id)
    rows = db.q("SELECT t.id,t.name,t.status FROM tests t JOIN test_issues r ON r.test_id=t.id WHERE r.issue_id=? AND t.project_id=? ORDER BY t.id", (issue_id, project_id))
    for row in rows:
        row["display_id"] = numbers.get(row["id"], 0)
    return rows


def linked_issues(db, project_id, test_id):
    numbers = db.project_local_map("issues", project_id)
    rows = db.q("SELECT i.id,i.title,i.status FROM issues i JOIN test_issues r ON r.issue_id=i.id WHERE r.test_id=? AND i.project_id=? ORDER BY i.id", (test_id, project_id))
    for row in rows:
        row["display_id"] = numbers.get(row["id"], 0)
    return rows


def replace_versions(connection, table, field, entity_id, values):
    ids = validate_ids(values, "软件版本")
    connection.execute(f"DELETE FROM {table} WHERE {field}=?", (entity_id,))
    connection.executemany(f"INSERT INTO {table}({field},version_id) VALUES(?,?)", [(entity_id, key) for key in ids])
