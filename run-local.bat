@echo off
setlocal enabledelayedexpansion
REM ================================================================
REM  d3recipes one-click local run -- Windows
REM  Requires: Python installed (https://www.python.org, tick "Add to PATH")
REM  Double-click to start and open the browser; press Ctrl+C to stop
REM ================================================================

set "ROOT=%~dp0"

REM  Detect layout: dev = web\ subfolder; release = flat (index.html beside the script)
if exist "%ROOT%web\index.html" (
  set "SERVE_DIR=%ROOT%web"
) else (
  set "SERVE_DIR=%ROOT%"
)

set "PORT=8080"
set "OPEN_BROWSER=1"

REM --- parse command-line arguments ---
:parse
if "%~1"=="" goto :parsed
if /i "%~1"=="--port" (
  set "PORT=%~2"
  shift
  shift
  goto :parse
)
if /i "%~1"=="--no-browser" (
  set "OPEN_BROWSER=0"
  shift
  goto :parse
)
echo Unknown argument: %~1
exit /b 1
:parsed

REM --- check index.html exists ---
if not exist "%SERVE_DIR%\index.html" (
  echo Error: index.html not found in %SERVE_DIR%. Please keep run-local.bat next to the release files.
  pause
  exit /b 1
)

REM --- find a usable python command ---
set "PY="
for %%c in (python py) do (
  where %%c >nul 2>nul
  if errorlevel 1 (rem not found) else (
    set "PY=%%c"
    goto :pyfound
  )
)
:pyfound
if not defined PY (
  echo Error: Python not found. Install it from https://www.python.org and check "Add to PATH".
  pause
  exit /b 1
)

set "URL=http://localhost:%PORT%"
echo ========================================
echo   d3recipes local  ^(Windows^)
echo   !URL!
echo   Press Ctrl+C to stop the server
echo ========================================
echo.

REM --- optional: open browser (delay so the server comes up) ---
if "%OPEN_BROWSER%"=="1" (
  start "" /b cmd /c "timeout /t 1 /nobreak >nul & start "" !URL!"
)

REM --- serve static files with Python ---
cd /d "%SERVE_DIR%"
"%PY%" -m http.server %PORT% --bind 127.0.0.1

endlocal