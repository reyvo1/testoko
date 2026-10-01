@echo off
setlocal
cd /d "%~dp0"
node scripts\workflow.mjs validate
if errorlevel 1 goto :failed
node scripts\workflow.mjs status
pause
exit /b 0
:failed
echo Workflow belum valid.
pause
exit /b 1
