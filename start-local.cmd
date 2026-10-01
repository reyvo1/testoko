@echo off
setlocal
cd /d "%~dp0"
if not exist .env (
  echo .env belum ada. Jalankan setup-local.cmd terlebih dahulu.
  pause
  exit /b 1
)
npm run dev
pause
