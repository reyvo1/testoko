@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"
node scripts\install-dependencies.mjs
if errorlevel 1 (
  echo.
  echo Instalasi gagal. Periksa folder logs.
  pause
  exit /b 1
)
echo.
echo Dependency berhasil dipasang.
pause
