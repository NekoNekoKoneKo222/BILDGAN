@echo off
echo [BILDGAN] Publishing local port 8792 via public HTTPS port 10000.
echo [BILDGAN] Make sure start-bildgan.cmd is already running.
tailscale funnel --bg --https=10000 http://127.0.0.1:8792
if errorlevel 1 (
  echo [BILDGAN] Funnel setup failed. Check Tailscale and login.
  pause
  exit /b 1
)
tailscale funnel status
echo [BILDGAN] The HTTPS URL on port 10000 is your public game URL.
pause
