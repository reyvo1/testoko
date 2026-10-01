@echo off
setlocal
cd /d "%~dp0"
echo ============================================================
echo Toko360 - Work Item dan Pekerjaan Otomatis
 echo ============================================================
where node >nul 2>&1
if errorlevel 1 goto :node_missing
node scripts\start-work.mjs menu
if errorlevel 1 goto :failed
node scripts\generate-chat-context.mjs generate --quiet >nul 2>&1
echo.
pause
exit /b 0
:node_missing
echo Node.js tidak ditemukan. Jalankan setup-local.cmd terlebih dahulu.
pause
exit /b 1
:failed
echo.
echo Pembuatan pekerjaan gagal. Periksa pesan di atas.
pause
exit /b 1
