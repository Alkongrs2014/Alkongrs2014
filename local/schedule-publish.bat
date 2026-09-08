@echo off
chcp 65001 >nul
cd /d "%~dp0.."
set "P=%CD%"
echo.
echo   جدولة كاملة مع النشر التلقائي على GitHub.
echo.
echo   أربع مهام بأربع دورات، لأن ما يتغيّر كل دقيقة هو السعر لا الشمعة
echo   المكتملة ولا سلسلة العقود ولا أرقام الشركة:
echo.
echo     WebTrade-Quotes   كل دقيقتين    أسعار فقط
echo     WebTrade-Market   كل 10 دقائق   شمعات ومؤشرات وإشارات وأخبار
echo     WebTrade-Options  كل 30 دقيقة   عقود الخيارات والجريكس
echo     WebTrade-Daily    يومياً 9:30   أساسيات وترتيب وأحداث وأرشيف
echo.
echo   لماذا دقيقتان لا دقيقة: دفعة أسعار ياهو تجمع 40 رمزاً في الطلب،
echo   لكن دورة أقصر لا تعطي بيانات أحدث — المصدر نفسه يتأخر دقائق.
echo.
echo   لماذا نصف ساعة للعقود: كل رمز يحتاج طلباً لكل تاريخ استحقاق،
echo   فسبعون رمزاً تعني ~140 طلباً، وسلسلة العقود لا تتغيّر بمعدّل الشمعة.
echo.
echo   المهام لا تتداخل: قفل في data يجعل المتأخّرة تنسحب، لأن دورتين
echo   معاً تتجاوزان حصّة الطلبات فيبدأ المزوّد بالرفض.
echo.
echo   يتطلب أن يكون المجلد مربوطاً بـ GitHub (local\link-github.bat).
echo.
pause
schtasks /Create /TN "WebTrade-Quotes"  /TR "wscript.exe \"%P%\local\run-hidden.vbs\" quotes --publish"  /SC MINUTE /MO 2 /F
schtasks /Create /TN "WebTrade-Market"  /TR "wscript.exe \"%P%\local\run-hidden.vbs\" market --publish"  /SC MINUTE /MO 10 /F
schtasks /Create /TN "WebTrade-Options" /TR "wscript.exe \"%P%\local\run-hidden.vbs\" options --publish" /SC MINUTE /MO 30 /F
schtasks /Create /TN "WebTrade-Daily"   /TR "wscript.exe \"%P%\local\run-hidden.vbs\" daily --publish"   /SC DAILY /ST 09:30 /F
echo.
echo   ضبط سقف زمني لكل مهمة حتى لا يعلّق تشغيل عالق البقية.
echo   المهمة اليومية سقفها ساعة: الأرشيف يجلب خمس سنوات لخمسمئة رمز.
powershell -NoProfile -Command "$l=@{'WebTrade-Quotes'='PT5M';'WebTrade-Market'='PT20M';'WebTrade-Options'='PT25M';'WebTrade-Daily'='PT60M'}; foreach($k in $l.Keys){$t=Get-ScheduledTask -TaskName $k; $t.Settings.ExecutionTimeLimit=$l[$k]; $t.Settings.MultipleInstances='IgnoreNew'; Set-ScheduledTask -TaskName $k -Settings $t.Settings | Out-Null}"
echo.
echo   تم. لإلغائها:
echo     schtasks /Delete /TN "WebTrade-Quotes" /F
echo     schtasks /Delete /TN "WebTrade-Market" /F
echo     schtasks /Delete /TN "WebTrade-Options" /F
echo     schtasks /Delete /TN "WebTrade-Daily" /F
pause
