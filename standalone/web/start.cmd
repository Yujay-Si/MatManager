@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 未找到 Node.js。请先安装 Node.js 18 或更高版本，或直接双击 index.html 使用离线版。
  pause
  exit /b 1
)
node server.js --open
if errorlevel 1 pause
endlocal
