"""Run dependency-free Node checks as part of the full pytest suite."""
from pathlib import Path
import shutil
import subprocess

import pytest

ROOT = Path(__file__).resolve().parents[1]


def node_binary():
    node = shutil.which("node")
    if node is None:
        pytest.fail("Node.js is required for frontend checks (no npm install/build required).")
    return node


def test_javascript_syntax():
    for script in sorted((ROOT / "static").rglob("*.js")):
        result = subprocess.run([node_binary(), "--check", str(script)], capture_output=True, text=True, encoding="utf-8", timeout=30)
        assert result.returncode == 0, f"{script}: {result.stderr}"


def test_frontend_runtime_regressions():
    result = subprocess.run([node_binary(), "--test", str(ROOT / "tests/frontend.test.cjs")], capture_output=True, text=True, encoding="utf-8", timeout=60)
    assert result.returncode == 0, result.stdout + result.stderr
