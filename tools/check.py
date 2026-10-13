"""Portable release checks; no server, database writes or Node build needed."""
from pathlib import Path
import py_compile
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def main():
    node = shutil.which("node")
    if node is None:
        print("Node.js 18+ is required for frontend syntax/regression checks.", file=sys.stderr)
        return 1
    sources = sorted(ROOT.glob("*.py"))
    sources += sorted((ROOT / "tests").rglob("*.py"))
    sources += sorted((ROOT / "tools").rglob("*.py"))
    # Compile into a temporary directory instead of leaving generated files in release.
    with tempfile.TemporaryDirectory(prefix="projectmanager-syntax-") as temp:
        for index, source in enumerate(sources):
            py_compile.compile(str(source), cfile=str(Path(temp) / f"{index}.pyc"), doraise=True)
    print(f"Python syntax: {len(sources)} files passed", flush=True)
    scripts = sorted((ROOT / "static").rglob("*.js")) + sorted((ROOT / "tests").rglob("*.cjs"))
    for script in scripts:
        subprocess.run([node, "--check", str(script)], check=True, timeout=30)
    print(f"JavaScript syntax: {len(scripts)} files passed", flush=True)
    return subprocess.run([sys.executable, "-m", "pytest", "-q"], cwd=ROOT, timeout=120).returncode


if __name__ == "__main__":
    raise SystemExit(main())
