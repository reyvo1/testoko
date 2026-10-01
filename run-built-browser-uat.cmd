@echo off
setlocal
cd /d "%~dp0"
if "%T360_UAT_ADMIN_EMAIL%"=="" (
  echo T360_UAT_ADMIN_EMAIL belum diisi.
  exit /b 2
)
if "%T360_UAT_ADMIN_PASSWORD%"=="" (
  echo T360_UAT_ADMIN_PASSWORD belum diisi.
  exit /b 2
)
if "%T360_UAT_ENVIRONMENT%"=="" set T360_UAT_ENVIRONMENT=LOCAL_UAT
if "%DATABASE_PROFILE%"=="postgresql" (
  if "%T360_UAT_EXPECTED_HOST%"=="" (
    echo T360_UAT_EXPECTED_HOST wajib diisi untuk PostgreSQL.
    exit /b 2
  )
  if "%T360_UAT_EXPECTED_DATABASE%"=="" (
    echo T360_UAT_EXPECTED_DATABASE wajib diisi untuk PostgreSQL.
    exit /b 2
  )
)
npm run uat:browser:built
exit /b %ERRORLEVEL%
