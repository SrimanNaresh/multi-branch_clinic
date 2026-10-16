@echo off
rem Double-click: repair https for abihomoeoclinic.thangaminfotech.com only (see fix-ssl.py).
cd /d "%~dp0.."
title SmartClinic fix-ssl
python deploy\fix-ssl.py
echo.
echo Finished. The full output is saved in deploy\last-fix.log
pause
