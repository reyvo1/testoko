@echo off
setlocal EnableExtensions
cd /d "%~dp0"
echo ============================================================
echo Toko360 - Pindah Chat dengan Checkpoint Otomatis
echo ============================================================
where node >nul 2>&1
if errorlevel 1 goto :node_missing
where git >nul 2>&1
if errorlevel 1 goto :git_missing

echo.
echo [1/3] Membuat ZIP checkpoint dari commit HEAD resmi...
node scripts\create-chat-checkpoint.mjs create
if errorlevel 1 goto :failed

echo.
echo [2/3] Membuat konteks terbaru dan menyalinnya ke clipboard...
node scripts\generate-chat-context.mjs first --no-open
if errorlevel 1 goto :failed

echo.
echo [3/3] Menyorot ZIP dan membuka ChatGPT...
node scripts\create-chat-checkpoint.mjs open
if errorlevel 1 goto :failed

echo.
echo ============================================================
echo SIAP PINDAH CHAT
echo 1. Unggah ZIP yang sedang disorot di File Explorer.
echo 2. Tekan Ctrl+V pada chat baru untuk menempelkan konteks.
echo 3. Kirim keduanya pada pesan pertama.
echo ============================================================
pause
exit /b 0

:node_missing
echo Node.js tidak ditemukan. Jalankan setup-local.cmd terlebih dahulu.
pause
exit /b 1

:git_missing
echo Git tidak ditemukan atau belum masuk PATH.
pause
exit /b 1

:failed
echo.
echo Pembuatan checkpoint/chat gagal. Tidak ada ZIP lama yang boleh dianggap terbaru.
echo Periksa pesan ERROR di atas.
pause
exit /b 1
