@echo off
setlocal
cd /d "%~dp0"

echo ============================================================
echo Toko360 Local API Compile Fix Verification
echo ============================================================
echo Folder: %CD%
echo.

if not exist package.json (
  echo ERROR: package.json tidak ditemukan. Jalankan file ini dari root tokojo-main.
  goto :fail
)
if not exist node_modules (
  echo ERROR: node_modules tidak ditemukan. Jangan gunakan launcher ini sebelum dependency terpasang.
  echo Jalankan setup-local.cmd hanya jika memang node_modules belum ada.
  goto :fail
)

echo [1/4] Regression khusus API compile...
node --test tests\api-local-compile-regression.test.mjs
if errorlevel 1 goto :fail

echo.
echo [2/4] Regenerate Prisma Client SQLite...
call npm run db:local:generate
if errorlevel 1 goto :fail

echo.
echo [3/4] Sinkronkan schema SQLite tanpa reset database...
call npm run db:local:push
if errorlevel 1 goto :fail

echo.
echo [4/4] Build API NestJS...
call npm run build -w @toko360/api
if errorlevel 1 goto :fail

echo.
echo ============================================================
echo PASS - API build berhasil.
echo Sekarang jalankan start-local.cmd atau npm run dev.
echo Lalu buka http://localhost:4000/api/v1/health
 echo ============================================================
pause
exit /b 0

:fail
echo.
echo ============================================================
echo FAIL - hentikan di sini dan kirim error yang tampil ke ChatGPT.
echo Jangan ulang npm ci dan jangan reset database.
echo ============================================================
pause
exit /b 1
