@echo off
setlocal
cd /d "%~dp0"
echo [Toko360] Verifying production promotion evidence chain...
npm run production:promotion:verify -- %*
exit /b %ERRORLEVEL%
