@echo off
setlocal
cd /d "%~dp0"
echo [Toko360] Verifying final production-ready evidence...
npm run production:ready:verify -- %*
exit /b %ERRORLEVEL%
