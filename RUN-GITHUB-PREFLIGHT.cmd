@echo off
setlocal
cd /d "%~dp0"
echo [TOKO360] Local dependency-free preflight before GitHub push...
call npm run ci:preflight:local
if errorlevel 1 (
  echo.
  echo [TOKO360] PREFLIGHT FAILED. Do not push this checkpoint to the heavy GitHub test farm yet.
  exit /b 1
)
echo.
echo [TOKO360] PREFLIGHT PASS. Heavy build, PostgreSQL, browser, worker, audit, Stage-18/19/20 simulation still run in GitHub Actions.
exit /b 0
