@echo off
cd /d "%~dp0"
title Carometro Geral - Escola Adventista de Ibiuna
echo Iniciando Sistema de Carometro Geral...
echo Banco de dados local: data\carometro.db
echo.
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:3000"
node server.js
pause
