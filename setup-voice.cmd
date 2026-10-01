@echo off
setlocal
set "PSModulePath="
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-voice.ps1" %*
set "setupResult=%errorlevel%"
if not "%setupResult%"=="0" pause
exit /b %setupResult%
