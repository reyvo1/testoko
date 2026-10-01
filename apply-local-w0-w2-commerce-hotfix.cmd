@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo ============================================================
echo Toko360 W0-W2 Functional Commerce Hotfix
echo Tidak menjalankan npm ci dan tidak mereset database.
echo ============================================================

if not exist node_modules (
  echo.
  echo FAIL - node_modules tidak ditemukan.
  echo Jalankan hanya pada checkout lokal yang dependency-nya sudah terpasang.
  exit /b 1
)
if not exist .env (
  echo.
  echo FAIL - file .env tidak ditemukan.
  exit /b 1
)

echo.
echo [1/8] Regression transaksi POS + retur...
node --test tests\core-pos-transaction-integrity.test.mjs tests\functional-w0-w2-pos-completeness.test.mjs tests\functional-w0-w2-return-workflow.test.mjs
if errorlevel 1 goto :fail

echo.
echo [2/8] Generate Prisma Client SQLite...
call npm run db:local:generate
if errorlevel 1 goto :fail

echo.
echo [3/8] Sinkronisasi schema SQLite non-destructive...
call npm run db:local:push
if errorlevel 1 goto :fail

echo.
echo [4/8] Upsert seed/config rule terbaru (termasuk SALE_SPLIT)...
call npm run db:local:seed
if errorlevel 1 goto :fail

echo.
echo [5/8] Build API...
call npm run build -w @toko360/api
if errorlevel 1 goto :fail

echo.
echo [6/8] Build POS...
call npm run build -w @toko360/pos
if errorlevel 1 goto :fail

echo.
echo [7/8] Build Admin...
call npm run build -w @toko360/admin
if errorlevel 1 goto :fail

echo.
echo [8/8] Repository validator...
node scripts\validate-repo.mjs
if errorlevel 1 goto :fail

echo.
echo ============================================================
echo PASS - W0-W2 hotfix siap diuji lokal.
echo Jalankan start-local.cmd lalu uji POS + Admin.
echo ============================================================
exit /b 0

:fail
echo.
echo ============================================================
echo FAIL - hotfix berhenti pada gate di atas.
echo Jangan npm ci/reset database. Kirim output error lengkap.
echo ============================================================
exit /b 1
