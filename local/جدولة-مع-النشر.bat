@echo off
chcp 65001 >nul
cd /d "%~dp0.."
set "P=%CD%"
echo.
echo   جدولة مع النشر التلقائي على GitHub.
echo.
echo   الفرق عن schedule.bat: بعد كل جلب ناجح تُدفع البيانات إلى
echo   فرع data، فيعرض الموقع المنشور نفس جودة النسخة المحلية.
echo   Yahoo يحظر خوادم GitHub فلا تكتمل شموعها هناك، وجهازك لا يُحظر.
echo.
echo   يتطلب أن يكون المجلد مربوطاً بـ GitHub (local\link-github.bat).
echo.
pause
schtasks /Create /TN "WebTrade-Market" /TR "node \"%P%\local\run.mjs\" market --publish" /SC MINUTE /MO 10 /F
schtasks /Create /TN "WebTrade-Daily"  /TR "node \"%P%\local\run.mjs\" daily --publish"  /SC DAILY /ST 09:30 /F
echo.
echo   تم. لإلغائها:  schtasks /Delete /TN "WebTrade-Market" /F
pause
