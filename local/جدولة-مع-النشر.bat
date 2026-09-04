@echo off
chcp 65001 >nul
cd /d "%~dp0.."
set "P=%CD%"
echo.
echo   جدولة كاملة مع النشر التلقائي على GitHub.
echo.
echo   ثلاث مهام بثلاث دورات مختلفة، لأن ما يتغيّر كل دقيقة هو السعر
echo   لا الشمعة المكتملة ولا أرقام الشركة:
echo.
echo     WebTrade-Quotes   كل دقيقتين   أسعار فقط  (~90 ثانية للدورة)
echo     WebTrade-Market   كل 10 دقائق  شمعات ومؤشرات وأخبار
echo     WebTrade-Daily    يومياً 9:30  أساسيات وترتيب الشركات
echo.
echo   لماذا دقيقتان لا دقيقة: المزوّد المجاني يسمح بـ 60 طلباً في
echo   الدقيقة، وكل سهم طلب مستقل، فسبعون سهماً تحتاج ~90 ثانية.
echo.
echo   المهام لا تتداخل: قفل في data يجعل المتأخّرة تنسحب، لأن دورتين
echo   معاً تتجاوزان حصّة الطلبات فيبدأ المزوّد بالرفض.
echo.
echo   يتطلب أن يكون المجلد مربوطاً بـ GitHub (local\link-github.bat).
echo.
pause
schtasks /Create /TN "WebTrade-Quotes" /TR "node \"%P%\local\run.mjs\" quotes --publish" /SC MINUTE /MO 2 /F
schtasks /Create /TN "WebTrade-Market" /TR "node \"%P%\local\run.mjs\" market --publish" /SC MINUTE /MO 10 /F
schtasks /Create /TN "WebTrade-Daily"  /TR "node \"%P%\local\run.mjs\" daily --publish"  /SC DAILY /ST 09:30 /F
echo.
echo   ضبط سقف زمني لكل مهمة حتى لا يعلّق تشغيل عالق البقية:
powershell -NoProfile -Command "$l=@{'WebTrade-Quotes'='PT5M';'WebTrade-Market'='PT20M';'WebTrade-Daily'='PT30M'}; foreach($k in $l.Keys){$t=Get-ScheduledTask -TaskName $k; $t.Settings.ExecutionTimeLimit=$l[$k]; $t.Settings.MultipleInstances='IgnoreNew'; Set-ScheduledTask -TaskName $k -Settings $t.Settings | Out-Null}"
echo.
echo   تم. لإلغائها:
echo     schtasks /Delete /TN "WebTrade-Quotes" /F
echo     schtasks /Delete /TN "WebTrade-Market" /F
echo     schtasks /Delete /TN "WebTrade-Daily" /F
pause
