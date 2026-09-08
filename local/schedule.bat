@echo off
chcp 65001 >nul
cd /d "%~dp0.."
set "P=%CD%"
echo.
echo   سيُنشأ جدولان في Task Scheduler:
echo     WebTrade-Market  كل 10 دقائق
echo     WebTrade-Daily   يومياً 9:30 صباحاً
echo.
schtasks /Create /TN "WebTrade-Market" /TR "wscript.exe \"%P%\local\run-hidden.vbs\" market" /SC MINUTE /MO 10 /F
schtasks /Create /TN "WebTrade-Daily"  /TR "wscript.exe \"%P%\local\run-hidden.vbs\" daily"  /SC DAILY /ST 09:30 /F
echo.
echo   تم. لإلغائها:  schtasks /Delete /TN "WebTrade-Market" /F
pause
