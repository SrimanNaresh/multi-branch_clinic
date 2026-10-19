@echo off
rem Double-click: send the Naresh branch to https://github.com/SrimanNaresh/multi-branch_clinic
cd /d "%~dp0.."
title SmartClinic push to GitHub
git push origin Naresh
echo.
git ls-remote --heads origin
echo.
echo Finished. Naresh is now on GitHub.
pause
