@echo off
setlocal
cd /d "%~dp0"
title SmartClinic launcher

rem ===== Change the ports here =====
set WEB_PORT=5180
set API_PORT=4000
rem ==================================

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not found. Install Node 20 or newer from https://nodejs.org and run this again.
  pause
  exit /b 1
)

if not exist "backend\.env" (
  copy "backend\.env.example" "backend\.env" >nul
  echo.
  echo Created backend\.env
  echo Set DB_USER and DB_PASSWORD for your MySQL, then SAVE and CLOSE Notepad to continue.
  start /wait notepad "backend\.env"
)

if not exist "backend\node_modules" (
  echo.
  echo Installing backend packages...
  pushd backend
  call npm install
  if errorlevel 1 goto fail
  popd
)

if not exist "frontend\node_modules" (
  echo.
  echo Installing frontend packages...
  pushd frontend
  call npm install
  if errorlevel 1 goto fail
  popd
)

if not exist "backend\.db-ready" (
  echo.
  echo Creating database and demo data...
  pushd backend
  call npm run db:init
  if errorlevel 1 goto fail
  call npm run seed
  if errorlevel 1 goto fail
  echo ok> .db-ready
  popd
)

echo.
echo Starting API (port %API_PORT%) and web app (port %WEB_PORT%)...
start "SmartClinic API" /d "%~dp0backend" cmd /k "set PORT=%API_PORT%&& set CORS_ORIGIN=http://localhost:%WEB_PORT%&& npm run dev"
start "SmartClinic Web" /d "%~dp0frontend" cmd /k "npm run dev -- --port %WEB_PORT% --strictPort"
timeout /t 8 >nul
start "" http://localhost:%WEB_PORT%

echo.
echo SmartClinic is opening at http://localhost:%WEB_PORT%
echo Login: superadmin / ChangeMe@123   (staff: cla.reception, cla.doctor, cla.pharmacy, cla.billing / Demo@123)
echo Keep the two new windows open while you use the app.
pause
exit /b 0

:fail
popd
echo.
echo Something failed. Copy the error text above and send it to Claude.
pause
exit /b 1
