@echo off
rem Corre o install.ps1 sem ter de mudar a politica de scripts do PowerShell.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
pause
