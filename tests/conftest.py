"""Each API test gets an isolated SQLite DB/settings/backup directory."""
import importlib
import os
from pathlib import Path
import sys
import tempfile

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
# app initializes its DB on import. Never import it against the user's database.
_import_data = tempfile.TemporaryDirectory(prefix="projectmanager-import-")
_previous = os.environ.get("PROJECTMANAGER_DATA_DIR")
os.environ["PROJECTMANAGER_DATA_DIR"] = _import_data.name
try:
    application = importlib.import_module("app")
finally:
    if _previous is None:
        os.environ.pop("PROJECTMANAGER_DATA_DIR", None)
    else:
        os.environ["PROJECTMANAGER_DATA_DIR"] = _previous


@pytest.fixture
def client(tmp_path, monkeypatch):
    from backend import Database

    monkeypatch.setattr(application, "BASE", tmp_path)
    monkeypatch.setattr(application, "DATA_DIR", tmp_path)
    monkeypatch.setattr(application, "DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr(application, "SETTINGS_PATH", tmp_path / "settings.json")
    monkeypatch.setattr(application, "db", Database(application.DB_PATH))
    with TestClient(application.app, client=("127.0.0.1", 50000)) as test_client:
        yield test_client


@pytest.fixture
def project(client):
    response = client.post("/api/projects", json={"name": "机器人回归项目", "owner": "tester"})
    assert response.status_code == 200
    return response.json()["id"]


@pytest.fixture
def version(client, project):
    return client.post(f"/api/versions/{project}", json={"version": "v1.0", "branch": "main"}).json()["id"]
