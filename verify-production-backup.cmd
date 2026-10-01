@echo off
setlocal
cd /d "%~dp0"
node scripts\verify-production-backup.mjs
exit /b %errorlevel%
