@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto :nonode

rem If something already answers on 4173 - another start.bat window, or a
rem dev server you left running - do not fight it for the port: just open it.
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://localhost:4173/; if ($r.StatusCode -eq 200) { exit 0 } } catch {}; exit 1" >nul 2>nul
if not errorlevel 1 goto :already

set REBUILD=0
if /i "%~1"=="build" set REBUILD=1

if not exist "node_modules" set REBUILD=1
if not exist "dist\index.html" set REBUILD=1

if "%REBUILD%"=="1" (
  echo [1/2] Installing dependencies, this needs the network once...
  call npm install
  if errorlevel 1 goto :failed
  echo [2/2] Building...
  call npm run build
  if errorlevel 1 goto :failed
)

echo.
echo Phasor Lab is starting at http://localhost:4173/
echo Keep this window open while you use it. Press Ctrl+C here to stop.
echo.
start "" http://localhost:4173/
call npx vite preview --port 4173 --strictPort
exit /b 0

:already
echo.
echo Phasor Lab is already serving on http://localhost:4173/ - opening it.
echo (No second copy was started. Close that window to stop the server.)
echo.
start "" http://localhost:4173/
exit /b 0

:nonode
echo Node.js was not found.
echo Please install the LTS build from https://nodejs.org and run this file again.
echo.
pause
exit /b 1

:failed
echo.
echo Something went wrong - the messages above should say what.
echo.
pause
exit /b 1
