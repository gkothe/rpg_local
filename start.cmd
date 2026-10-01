@echo off
setlocal
set "PSModulePath="
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start.ps1" %*
set "startupResult=%errorlevel%"
if not "%startupResult%"=="0" pause
exit /b %startupResult%
