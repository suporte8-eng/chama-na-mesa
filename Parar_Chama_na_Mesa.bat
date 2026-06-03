@echo off
title Parar Chama na Mesa
echo Parando processos do Chama na Mesa em segundo plano...
powershell -Command "Get-CimInstance Win32_Process -Filter \"CommandLine like '%%runner.js%%' or CommandLine like '%%server.js%%' or CommandLine like '%%localtunnel%%'\" | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
echo Sistema parado com sucesso!
timeout /t 3
