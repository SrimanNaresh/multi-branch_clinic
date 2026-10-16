@echo off
setlocal
cd /d "%~dp0"
title SmartClinic

rem ===== Change the port here (the app opens at http://localhost:PORT) =====
set APP_PORT=5180
rem ==========================================================================

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install the LTS version from https://nodejs.org and run this again.
  pause
  exit /b 1
)

if not exist "backend\node_modules\mysql2" (
  echo The folder backend\node_modules is missing. Unzip the full multi-branch_clinic.zip again.
  pause
  exit /b 1
)

if not exist "backend\.env" (
  copy "backend\.env.example" "backend\.env" >nul
  echo.
  echo First run: Notepad will open backend\.env
  echo Set DB_USER and DB_PASSWORD for your MySQL, then SAVE and CLOSE Notepad.
  start /wait notepad "backend\.env"
)

if not exist "backend\.db-ready" (
  echo.
  echo Creating the database and demo data...
  pushd backend
  node scripts\init-db.js
  if errorlevel 1 goto dbfail
  node scripts\seed.js
  if errorlevel 1 goto dbfail
  echo ok> .db-ready
  popd
)

echo.
start "" cmd /c "timeout /t 3 >nul & start http://localhost:%APP_PORT%"
cd backend
set PORT=%APP_PORT%
set CORS_ORIGIN=http://localhost:%APP_PORT%
echo Login: superadmin / ChangeMe@123    Staff: cla.reception, cla.doctor, cla.pharmacy, cla.billing / Demo@123
echo.
node src\server.js
echo.
echo SmartClinic stopped. If you see an error above, send a screenshot of this window to Claude.
pause
exit /b 0

:dbfail
popd
echo.
echo Could not set up the database.
echo  - Make sure MySQL is running (XAMPP: click Start next to MySQL).
echo  - Check DB_USER / DB_PASSWORD in backend\.env  (opening it now)
start notepad "backend\.env"
echo Then run start-windows.bat again. If it still fails, send a screenshot of this window to Claude.
pause
exit /b 1
