@echo off
setlocal
title Ultimate SDI Lab
cd /d "%~dp0"

set "PYTHON_LAUNCHER=py -3"
py -3 --version >nul 2>&1
if errorlevel 1 (
  python --version >nul 2>&1
  if errorlevel 1 goto no_python
  set "PYTHON_LAUNCHER=python"
)

if not exist ".venv\Scripts\python.exe" (
  echo Creating the native adapter environment...
  %PYTHON_LAUNCHER% -m venv .venv
  if errorlevel 1 goto setup_failed
)

".venv\Scripts\python.exe" -c "import usb, libusb_package, sdl2" >nul 2>&1
if errorlevel 1 (
  echo Installing the native USB components. This only happens once...
  ".venv\Scripts\python.exe" -m pip install --disable-pip-version-check -r requirements.txt
  if errorlevel 1 goto setup_failed
)

".venv\Scripts\python.exe" native_bridge.py
if errorlevel 1 goto launch_failed
exit /b 0

:no_python
echo.
echo Python 3.9 or newer is required for the native adapter helper.
echo Install it from https://www.python.org/downloads/windows/
echo Enable "Add python.exe to PATH" during installation, then run this file again.
start "" "https://www.python.org/downloads/windows/"
pause
exit /b 1

:setup_failed
echo.
echo Native USB setup failed. Check your internet connection and copy this window's error.
pause
exit /b 1

:launch_failed
echo.
echo The trainer stopped unexpectedly. Copy this window's error with Connection details.
pause
exit /b 1
