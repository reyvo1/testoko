@echo off
setlocal
cd /d "%~dp0"
node scripts\run-quality-gate.mjs full
if errorlevel 1 goto :failed
node scripts\generate-chat-context.mjs generate --quiet >nul 2>&1
echo Full quality gate lulus.
pause
exit /b 0
:failed
node scripts\generate-chat-context.mjs generate --quiet >nul 2>&1
echo Full quality gate gagal. Jangan merge atau release.
pause
exit /b 1
