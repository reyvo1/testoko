@echo off
setlocal
cd /d "%~dp0"
echo [Toko360] Running read-only production smoke plus auth session lifecycle...
npm run production:smoke -- %*
exit /b %ERRORLEVEL%
