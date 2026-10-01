@echo off
setlocal
cd /d "%~dp0"
echo [Toko360] Verifying production PostgreSQL schema contract in READ ONLY mode...
npm run production:schema:verify -- %*
exit /b %ERRORLEVEL%
