@echo off
setlocal
cd /d "%~dp0"
echo [Toko360] Running non-production PostgreSQL backup/restore rehearsal...
npm run db:dr:rehearse:postgres -- %*
exit /b %ERRORLEVEL%
