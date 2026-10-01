@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 goto :node_missing
node scripts\agent-doctor.mjs
echo.
pause
exit /b %errorlevel%
:node_missing
echo Node.js tidak ditemukan. Jalankan setup-local.cmd terlebih dahulu.
pause
exit /b 1
