@echo off
setlocal
cd /d "%~dp0"
echo TOKO360 Browser UAT - non-production only
if "%T360_UAT_ADMIN_EMAIL%"=="" (
  echo ERROR: set T360_UAT_ADMIN_EMAIL terlebih dahulu.
  exit /b 2
)
if "%T360_UAT_ADMIN_PASSWORD%"=="" (
  echo ERROR: set T360_UAT_ADMIN_PASSWORD terlebih dahulu.
  exit /b 2
)
node scripts\browser-uat.mjs
exit /b %ERRORLEVEL%
