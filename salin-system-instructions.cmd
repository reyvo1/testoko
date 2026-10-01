@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 goto :node_missing
node scripts\generate-chat-context.mjs system
if errorlevel 1 goto :failed
echo.
echo Instruksi sistem terbaru sudah disalin ke clipboard.
pause
exit /b 0
:node_missing
echo Node.js tidak ditemukan. Jalankan setup-local.cmd terlebih dahulu.
pause
exit /b 1
:failed
echo Gagal menyalin instruksi sistem.
pause
exit /b 1
