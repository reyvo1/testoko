@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"
node scripts\diagnose-install.mjs
echo.
echo Kirimkan file logs\diagnose-install.log bila masih gagal.
pause
