"""Regression coverage for automatic dates, hierarchical ranges, and tomorrow's plan."""
import sqlite3
import pytest
from backend import Database
from conftest import application


def create(client, project, **values):
    response = client.post(f'/api/tasks/{project}', json={'title': '任务', **values})
    assert response.status_code == 200, response.text
    return response.json()['id']


def task(client, project, task_id):
    return next(row for row in client.get(f'/api/tasks/{project}').json() if row['id'] == task_id)


def test_default_dates_follow_last_sibling_and_scope(client, project, monkeypatch):
    monkeypatch.setattr(application, 'today_text', lambda: '2026-10-10')
    parent = create(client, project, start_date='2026-10-20', due_date='2026-10-23')
    next_task = create(client, project)
    assert task(client, project, next_task)['start_date'] == '2026-10-24'
    child = create(client, project, parent_id=parent)
    assert task(client, project, child)['start_date'] == '2026-10-20'
    second_child = create(client, project, parent_id=parent)
    assert task(client, project, second_child)['start_date'] == '2026-10-21'
    other = client.post('/api/projects', json={'name': '另一项目'}).json()['id']
    first = create(client, other)
    assert task(client, other, first)['start_date'] == '2026-10-10'


def test_multiple_predecessors_shift_and_preserve_duration(client, project):
    a = create(client, project, start_date='2026-10-01', due_date='2026-10-10')
    b = create(client, project, start_date='2026-10-01', due_date='2026-10-15')
    successor = create(client, project, start_date='2026-10-08', due_date='2026-10-11', dependency_ids=[a, b])
    row = task(client, project, successor)
    assert (row['start_date'], row['due_date']) == ('2026-10-16', '2026-10-19')
    assert row['schedule_conflict'] is False


def test_editing_predecessor_propagates_through_chain(client, project):
    a = create(client, project, start_date='2026-10-01', due_date='2026-10-02')
    b = create(client, project, start_date='2026-10-03', due_date='2026-10-05', dependency_ids=[a])
    c = create(client, project, start_date='2026-10-06', due_date='2026-10-07', dependency_ids=[b])
    response = client.put(f'/api/tasks/item/{a}', json={'due_date': '2026-10-12'})
    assert response.status_code == 200
    assert (task(client, project, b)['start_date'], task(client, project, b)['due_date']) == ('2026-10-13', '2026-10-15')
    assert (task(client, project, c)['start_date'], task(client, project, c)['due_date']) == ('2026-10-16', '2026-10-17')


def test_dependency_only_endpoint_also_schedules(client, project):
    predecessor = create(client, project, start_date='2026-10-01', due_date='2026-10-20')
    current = create(client, project, start_date='2026-10-01', due_date='2026-10-03')
    assert client.put(f'/api/tasks/item/{current}/dependencies', json={'dependency_ids': [predecessor]}).status_code == 200
    assert task(client, project, current)['due_date'] == '2026-10-23'


def test_child_expands_all_ancestors_and_parent_successor(client, project):
    root = create(client, project, start_date='2026-10-10', due_date='2026-10-12')
    parent = create(client, project, parent_id=root, start_date='2026-10-10', due_date='2026-10-12')
    successor = create(client, project, start_date='2026-10-13', due_date='2026-10-14', dependency_ids=[root])
    child = create(client, project, parent_id=parent, start_date='2026-10-05', due_date='2026-10-20')
    for key in (root, parent):
        row = task(client, project, key)
        assert (row['start_date'], row['due_date']) == ('2026-10-05', '2026-10-20')
    assert task(client, project, successor)['start_date'] == '2026-10-21'
    assert client.put(f'/api/tasks/item/{child}', json={'due_date': '2026-10-25'}).status_code == 200
    assert task(client, project, root)['due_date'] == '2026-10-25'
    assert task(client, project, successor)['start_date'] == '2026-10-26'


def test_delayed_parent_moves_children_without_losing_duration(client, project):
    predecessor = create(client, project, start_date='2026-10-01', due_date='2026-10-05')
    parent = create(client, project, start_date='2026-10-06', due_date='2026-10-09', dependency_ids=[predecessor])
    child = create(client, project, parent_id=parent, start_date='2026-10-06', due_date='2026-10-08')
    grandchild = create(client, project, parent_id=child, start_date='2026-10-06', due_date='2026-10-07')
    assert client.put(f'/api/tasks/item/{predecessor}', json={'due_date': '2026-10-15'}).status_code == 200
    assert task(client, project, child)['due_date'] == '2026-10-18'
    assert task(client, project, grandchild)['due_date'] == '2026-10-17'
    assert task(client, project, parent)['start_date'] == '2026-10-16'


def test_hierarchy_dependency_date_cycle_rolls_back_atomically(client, project):
    parent = create(client, project, start_date='2026-10-01', due_date='2026-10-03')
    response = client.post(f'/api/tasks/{project}', json={'title': '无效子任务', 'parent_id': parent, 'dependency_ids': [parent]})
    assert response.status_code == 400 and '日期循环' in response.json()['detail']
    assert len(client.get(f'/api/tasks/{project}').json()) == 1
    child = create(client, project, parent_id=parent)
    before = task(client, project, parent)
    response = client.put(f'/api/tasks/item/{parent}', json={'title': '不应保存', 'dependency_ids': [child]})
    assert response.status_code == 400
    assert task(client, project, parent)['title'] == before['title']
    assert task(client, project, parent)['dependency_ids'] == []


@pytest.mark.parametrize('field,value', [('start_date', 'bad-date'), ('due_date', '2026-02-30')])
def test_invalid_dates_do_not_save_partial_tasks(client, project, field, value):
    response = client.post(f'/api/tasks/{project}', json={'title': '无效日期', field: value})
    assert response.status_code == 400
    assert client.get(f'/api/tasks/{project}').json() == []


def test_schedule_overflow_returns_validation_error(client, project):
    predecessor = create(client, project, start_date='9999-12-30', due_date='9999-12-31')
    response = client.post(f'/api/tasks/{project}', json={'title': '超出范围', 'start_date': '9999-12-30', 'due_date': '9999-12-31', 'dependency_ids': [predecessor]})
    assert response.status_code == 400
    assert len(client.get(f'/api/tasks/{project}').json()) == 1


def test_tomorrow_plan_survives_reload_listing_and_old_client_save(client):
    url = '/api/daily-logs/2026-10-10'
    assert client.get(url).json()['tomorrow'] == ''
    response = client.put(url, json={'revision': 0, 'planned': '今日', 'actual': '结果', 'tomorrow': '明日计划\n继续联调', 'progress': 47})
    assert response.status_code == 200
    assert client.get(url).json()['tomorrow'] == '明日计划\n继续联调'
    assert client.get('/api/daily-logs?year=2026&month=10').json()[0]['tomorrow'] == '明日计划\n继续联调'
    assert client.put(url, json={'revision': 1, 'actual': '旧客户端保存', 'progress': 47}).status_code == 200
    assert client.get(url).json()['tomorrow'] == '明日计划\n继续联调'
    assert client.get(url).json()['progress'] == 47
    assert client.put(url, json={'revision': 2, 'tomorrow': ''}).status_code == 200
    assert client.get(url).json()['tomorrow'] == ''


@pytest.mark.parametrize('value', [123, 'x' * 50001], ids=['non-text', 'too-long'])
def test_invalid_tomorrow_plan_preserves_revision(client, value):
    url = '/api/daily-logs/2026-10-10'
    assert client.put(url, json={'revision': 0, 'tomorrow': value}).status_code == 400
    assert client.get(url).json()['revision'] == 0


def test_existing_journal_schema_migrates_and_preserves_data(tmp_path):
    path = tmp_path / 'old.db'
    with sqlite3.connect(path) as connection:
        connection.execute("CREATE TABLE daily_logs(id INTEGER PRIMARY KEY,log_date TEXT UNIQUE,planned TEXT,actual TEXT,progress INTEGER,revision INTEGER DEFAULT 1,created_at TEXT,updated_at TEXT)")
        connection.execute("INSERT INTO daily_logs VALUES(1,'2026-10-09','旧计划','旧结果',37,4,'old','old')")
    database = Database(path)
    row = database.one('SELECT * FROM daily_logs WHERE id=1')
    assert row['tomorrow'] == '' and row['progress'] == 37 and row['revision'] == 4
    assert row['planned'] == '旧计划' and row['actual'] == '旧结果'


def test_backup_includes_tomorrow_plan_and_expanded_parent_dates(client, project):
    parent = create(client, project, start_date='2026-10-01', due_date='2026-10-03')
    create(client, project, parent_id=parent, start_date='2026-10-02', due_date='2026-10-20')
    response = client.put('/api/daily-logs/2026-10-10', json={'revision': 0, 'tomorrow': '备份中的明日计划'})
    assert response.status_code == 200
    assert client.get('/api/daily-logs/archive').json()['years'][0]['months'][0]['days'][0]['summary'] == '备份中的明日计划'
    backup = client.post('/api/settings/backup')
    assert backup.status_code == 200
    with sqlite3.connect(backup.json()['path']) as connection:
        assert connection.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
        assert connection.execute('SELECT tomorrow FROM daily_logs').fetchone()[0] == '备份中的明日计划'
        assert connection.execute('SELECT due_date FROM tasks WHERE id=?', (parent,)).fetchone()[0] == '2026-10-20'
