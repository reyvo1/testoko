@echo off
setlocal
cd /d "%~dp0"
if not exist payroll-adjustment-postgres-stage.env (
  echo payroll-adjustment-postgres-stage.env belum ada.
  echo Salin config\payroll-adjustment-postgres-stage.env.example lalu isi target TEST/STAGING yang benar.
  exit /b 2
)
npm run db:payroll-adjustment:stage:postgres
set EXITCODE=%ERRORLEVEL%
if not "%EXITCODE%"=="0" (
  echo.
  echo PAYROLL ADJUSTMENT STAGING MIGRATION GAGAL.
  echo Lihat logs\payroll-adjustment-postgres-stage\latest.json
  pause
  exit /b %EXITCODE%
)
echo.
echo PAYROLL ADJUSTMENT STAGING MIGRATION PASS.
pause
