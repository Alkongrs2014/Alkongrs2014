@echo off
chcp 65001 >nul
cd /d "%~dp0.."
set "P=%CD%"
echo.
echo   ستُنشأ ثلاث مهام في Task Scheduler (بلا نشر على GitHub):
echo     WebTrade-Market   كل 10 دقائق   شمعات ومؤشرات وإشارات وأخبار
echo     WebTrade-Options  كل 30 دقيقة   عقود الخيارات والجريكس
echo     WebTrade-Daily    يومياً 9:30   أساسيات وترتيب وأحداث وأرشيف
echo.
echo   للنشر التلقائي على GitHub استعمل schedule-publish.bat بدلاً منه.
echo.
schtasks /Create /TN "WebTrade-Market"  /TR "wscript.exe \"%P%\local\run-hidden.vbs\" market"  /SC MINUTE /MO 10 /F
schtasks /Create /TN "WebTrade-Options" /TR "wscript.exe \"%P%\local\run-hidden.vbs\" options" /SC MINUTE /MO 30 /F
schtasks /Create /TN "WebTrade-Daily"   /TR "wscript.exe \"%P%\local\run-hidden.vbs\" daily"   /SC DAILY /ST 09:30 /F
echo.
echo   تم. لإلغائها:
echo     schtasks /Delete /TN "WebTrade-Market" /F
echo     schtasks /Delete /TN "WebTrade-Options" /F
echo     schtasks /Delete /TN "WebTrade-Daily" /F
pause
