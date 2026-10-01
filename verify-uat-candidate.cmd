@echo off
setlocal
cd /d "%~dp0"
npm run uat:candidate:verify
set EXITCODE=%ERRORLEVEL%
if not "%EXITCODE%"=="0" (
  echo.
  echo BELUM UAT CANDIDATE. Evidence build, browser, atau Stage-20 belum PASS atau source fingerprint berbeda.
  pause
  exit /b %EXITCODE%
)
echo.
echo UAT CANDIDATE VERIFIED. Ini belum izin production deployment.
pause
