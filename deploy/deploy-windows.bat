@echo off
rem Double-click to deploy SmartClinic to abihomoeoclinic.thangaminfotech.com (replaces the old site there).
cd /d "%~dp0.."
title SmartClinic deploy
python deploy\deploy.py --replace
echo.
echo Finished. The full output is saved in deploy\last-deploy.log
pause
