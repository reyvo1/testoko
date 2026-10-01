@echo off
setlocal
cd /d "%~dp0"
echo Menjalankan deterministic dependency + Prisma + test + six-app production build gate...
npm run build:gate
set EXITCODE=%ERRORLEVEL%
if not "%EXITCODE%"=="0" (
  echo.
  echo BUILD GATE GAGAL. Lihat handoff\quality\build-gate-latest.json
  pause
  exit /b %EXITCODE%
)
echo.
echo BUILD GATE PASS. Evidence: handoff\quality\build-gate-latest.json
pause
