@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================================
echo Toko360 Local Setup - tanpa Docker
echo ============================================================
echo Folder: %CD%
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js belum terpasang atau tidak ada di PATH.
  echo Instal Node.js 22 LTS, tutup terminal, lalu jalankan kembali.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo ERROR: npm tidak ditemukan. Instal ulang Node.js beserta npm.
  pause
  exit /b 1
)

node scripts\setup-local.mjs
if errorlevel 1 (
  echo.
  echo ============================================================
  echo Setup gagal.
  echo Log diagnosis ada di folder: %CD%\logs
  echo Jalankan diagnose-install.cmd lalu kirimkan diagnose-install.log.
  echo ============================================================
  pause
  exit /b 1
)

node scripts\generate-chat-context.mjs generate --quiet >nul 2>&1

echo.
echo Setup berhasil. Paket chat awal tersedia di handoff\generated.
pause
