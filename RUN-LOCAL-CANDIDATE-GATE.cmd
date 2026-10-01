@echo off
setlocal
cd /d "%~dp0"

echo [TOKO360] Local candidate gate before GitHub Full System Simulation...
if /I "%NODE_ENV%"=="production" (
  echo [TOKO360] REFUSED: NODE_ENV=production.
  exit /b 2
)
if /I "%DATABASE_PROFILE%"=="postgresql" (
  echo [TOKO360] REFUSED: local candidate gate must use SQLite. PostgreSQL is validated in GitHub.
  exit /b 2
)

call npm run uat:pre-github:local
if errorlevel 1 (
  echo.
  echo [TOKO360] LOCAL CANDIDATE FAILED. Do not push this checkpoint to GitHub Full System Simulation.
  exit /b 1
)

echo.
echo [TOKO360] LOCAL CANDIDATE PASS.
echo [TOKO360] Next gate: commit/push exact source and run GitHub Full System Simulation.
echo [TOKO360] Human Stage-20 UAT remains PENDING.
exit /b 0
