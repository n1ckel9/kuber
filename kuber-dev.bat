@echo off
title Kuber DEV launcher

set "PROJECT_DIR=C:\Users\test\Documents\vodovoz"

if not exist "%PROJECT_DIR%\package.json" (
  echo [ERROR] Project not found at "%PROJECT_DIR%"
  echo Edit PROJECT_DIR in this .bat if the folder moved.
  pause
  exit /b 1
)

cd /d "%PROJECT_DIR%"

echo ==========================================================
echo   Kuber - local dev
echo   API:  http://localhost:4000
echo   Web:  will open in the browser automatically
echo ==========================================================
echo.

REM Two windows (child cmd inherits this folder): API server and Expo web.
start "Kuber API" cmd /k npm run server
start "Kuber Web" cmd /k npm run web

echo Started two windows: "Kuber API" and "Kuber Web".
echo You can close this window.
timeout /t 4 >nul
