@echo off
setlocal
cd /d "%~dp0"

if not exist .venv (
  py -3 -m venv .venv
)
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip
python -m pip install -r requirements.txt

python -m PyInstaller ^
  --noconfirm ^
  --clean ^
  --onefile ^
  --windowed ^
  --icon "app_icon.ico" ^
  --add-data "static;static" ^
  --collect-all fastapi ^
  --collect-all starlette ^
  --collect-all uvicorn ^
  --hidden-import uvicorn.logging ^
  --hidden-import uvicorn.loops.auto ^
  --hidden-import uvicorn.protocols.http.auto ^
  --hidden-import uvicorn.protocols.websockets.auto ^
  --hidden-import uvicorn.lifespan.on ^
  --name projectmanager ^
  app.py

echo.
echo ==========================================
echo BUILD COMPLETE
echo dist\projectmanager.exe
echo ==========================================
pause
