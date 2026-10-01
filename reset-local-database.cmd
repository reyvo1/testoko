@echo off
setlocal
cd /d "%~dp0"
node scripts\reset-local-db.mjs
pause
