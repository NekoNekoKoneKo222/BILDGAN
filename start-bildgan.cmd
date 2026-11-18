@echo off
setlocal
cd /d "%~dp0"
set "PORT=8792"
echo [BILDGAN] Starting local game server on http://127.0.0.1:%PORT%
echo [BILDGAN] This console must stay open while players are connected.
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 20 or later first.
  pause
  exit /b 1
)
if not exist "node_modules" (
  echo [BILDGAN] Installing dependencies...
  call npm.cmd install --no-audit --no-fund
  if errorlevel 1 goto failed
)
echo [BILDGAN] Checking server code...
call npm.cmd run check
if errorlevel 1 goto failed
echo [BILDGAN] Running physics and networking tests...
call npm.cmd test
if errorlevel 1 goto failed
echo [BILDGAN] Building browser assets...
call npm.cmd run build
if errorlevel 1 goto failed
echo [BILDGAN] Ready! Local URL: http://127.0.0.1:%PORT%
echo [BILDGAN] In another PowerShell window run:
echo tailscale funnel --bg --https=10000 http://127.0.0.1:%PORT%
call npm.cmd start
echo [BILDGAN] Server stopped.
pause
exit /b 0
:failed
echo [BILDGAN] Startup failed. Review the error above.
pause
exit /b 1
