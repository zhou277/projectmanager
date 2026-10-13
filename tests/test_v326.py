"""Work-week boundary, persistent ordering and Issue/test relation regressions."""
from datetime import date
import sqlite3
import pytest
from backend import Database
from conftest import application


def make_test(client, project, name='测试'):
    response=client.post(f'/api/tests/{project}', json={'name':name})
    assert response.status_code==200
    return response.json()['id']


def issue_row(client, project, issue):
    return next(row for row in client.get(f'/api/issues/{project}').json() if row['id']==issue)


def test_project_order_persists_appends_and_survives_delete(client, project):
    second=client.post('/api/projects',json={'name':'第二项目'}).json()['id']
    third=client.post('/api/projects',json={'name':'第三项目'}).json()['id']
    order=[third,project,second]
    assert client.put('/api/projects/order',json={'project_ids':order}).status_code==200
    assert [row['id'] for row in client.get('/api/projects').json()]==order
    reopened=Database(application.DB_PATH)
    assert [row['id'] for row in reopened.q('SELECT id FROM projects ORDER BY sort_order,id')]==order
    fourth=client.post('/api/projects',json={'name':'第四项目'}).json()['id']
    assert [row['id'] for row in client.get('/api/projects').json()]==order+[fourth]
    assert client.delete(f'/api/projects/{project}').status_code==200
    assert [row['id'] for row in client.get('/api/projects').json()]==[third,second,fourth]


@pytest.mark.parametrize('values,status', [([],409),([1,1],400),([999],409),([True],400),('bad',400),([0],400),([None],400)])
def test_invalid_or_stale_order_does_not_change_projects(client,project,values,status):
    before=client.get('/api/projects').json()
    assert client.put('/api/projects/order',json={'project_ids':values}).status_code==status
    assert client.get('/api/projects').json()==before


def test_issue_can_link_multiple_tests_and_partial_update_preserves_links(client,project):
    first=make_test(client,project,'回归一');second=make_test(client,project,'回归二')
    created=client.post(f'/api/issues/{project}',json={'title':'问题','test_ids':[second,str(first),first]})
    assert created.status_code==200
    issue=created.json()['id'];row=issue_row(client,project,issue)
    assert row['test_ids']==[first,second]
    assert [test['display_id'] for test in row['tests']]==[1,2]
    assert row['tests'][0]['name']=='回归一'
    tests=client.get(f'/api/tests/{project}').json()
    assert all(test['issues'][0]['id']==issue for test in tests)
    assert client.put(f'/api/issues/item/{issue}',json={'title':'改名'}).status_code==200
    assert issue_row(client,project,issue)['test_ids']==[first,second]
    assert client.put(f'/api/issues/item/{issue}',json={'test_ids':[second]}).status_code==200
    assert issue_row(client,project,issue)['test_ids']==[second]
    assert client.put(f'/api/issues/item/{issue}',json={'test_ids':[]}).status_code==200
    assert issue_row(client,project,issue)['tests']==[]


@pytest.mark.parametrize('values', [[999],[True],[0],'bad',[None]])
def test_invalid_issue_test_links_roll_back_create(client,project,values):
    response=client.post(f'/api/issues/{project}',json={'title':'不应保存','test_ids':values})
    assert response.status_code==400
    assert client.get(f'/api/issues/{project}').json()==[]


def test_cross_project_links_roll_back_update_including_versions(client,project,version):
    valid=make_test(client,project)
    other=client.post('/api/projects',json={'name':'其他项目'}).json()['id']
    foreign=make_test(client,other)
    assert client.post(f'/api/issues/{project}',json={'title':'跨项目','test_ids':[foreign]}).status_code==400
    issue=client.post(f'/api/issues/{project}',json={'title':'原标题','test_ids':[valid],'version_ids':[version]}).json()['id']
    response=client.put(f'/api/issues/item/{issue}',json={'title':'不应保存','test_ids':[foreign],'version_ids':[]})
    assert response.status_code==400
    row=issue_row(client,project,issue)
    assert row['title']=='原标题' and row['test_ids']==[valid] and row['versions']==['v1.0']


def test_relation_cleanup_on_test_issue_and_project_deletion(client,project):
    current=make_test(client,project)
    issue=client.post(f'/api/issues/{project}',json={'title':'问题','test_ids':[current]}).json()['id']
    assert client.delete(f'/api/tests/item/{current}').status_code==200
    assert issue_row(client,project,issue)['test_ids']==[]
    next_test=make_test(client,project)
    assert client.put(f'/api/issues/item/{issue}',json={'test_ids':[next_test]}).status_code==200
    assert client.delete(f'/api/issues/item/{issue}').status_code==200
    assert client.get(f'/api/tests/{project}').json()[0]['issues']==[]
    client.post(f'/api/issues/{project}',json={'title':'另一个问题','test_ids':[next_test]})
    assert client.delete(f'/api/projects/{project}').status_code==200
    assert application.db.q('SELECT * FROM test_issues')==[]


def test_work_week_archive_handles_cross_year_and_weekday(client):
    days=['2025-12-28','2025-12-29','2026-01-01','2026-01-04','2026-01-05','2026-12-31','2027-01-01']
    for day in days:
        assert client.put('/api/daily-logs/'+day,json={'revision':0,'actual':'不用于预览的内容'}).status_code==200
    archive=client.get('/api/daily-logs/archive').json()
    years={row['year']:row for row in archive['work_years']}
    assert set(years)=={2025,2026}
    weeks={row['week']:row for row in years[2026]['weeks']}
    assert set(weeks)=={1,2,53}
    assert weeks[1]['start_date']=='2025-12-29' and weeks[1]['end_date']=='2026-01-04'
    assert {row['log_date'] for row in weeks[1]['days']}=={'2025-12-29','2026-01-01','2026-01-04'}
    assert weeks[1]['count']==3
    assert sorted(row['weekday'] for row in weeks[1]['days'])==[1,4,7]
    assert {row['log_date'] for row in weeks[53]['days']}=={'2026-12-31','2027-01-01'}
    assert all('summary' not in day for year in archive['work_years'] for week in year['weeks'] for day in week['days'])
    assert archive['years']  # Legacy month API remains compatible.


def test_migration_and_backup_preserve_order_and_existing_test_links(client,project,tmp_path):
    old_path=tmp_path/'old.db'
    with sqlite3.connect(old_path) as connection:
        connection.execute('CREATE TABLE projects(id INTEGER PRIMARY KEY,name TEXT,owner TEXT,description TEXT,start_date TEXT,target_date TEXT,created_at TEXT)')
        connection.execute("INSERT INTO projects VALUES(1,'旧项目','','','','','old')")
    database=Database(old_path)
    assert database.one('SELECT sort_order,name FROM projects WHERE id=1')=={'sort_order':0,'name':'旧项目'}
    current=make_test(client,project)
    issue=client.post(f'/api/issues/{project}',json={'title':'问题'}).json()['id']
    application.db.exec('INSERT INTO test_issues VALUES(?,?)',(current,issue))
    assert issue_row(client,project,issue)['test_ids']==[current]
    response=client.post('/api/settings/backup');assert response.status_code==200
    with sqlite3.connect(response.json()['path']) as connection:
        assert connection.execute('SELECT test_id FROM test_issues WHERE issue_id=?',(issue,)).fetchone()[0]==current
        assert connection.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
        assert connection.execute('SELECT sort_order FROM projects WHERE id=?',(project,)).fetchone() is not None
