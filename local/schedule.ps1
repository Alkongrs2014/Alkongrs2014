# =====================================================================
#  جدولة مهام المرصد في Task Scheduler.
#
#  لماذا PowerShell لا ملف .bat؟
#  cmd.exe يتتبّع موضعه في ملف الدفعة بالبايتات، ويعيد قراءة الموضع بعد
#  كل أمر. مع `chcp 65001` وملف UTF-8 فيه نص عربي طويل يختلّ هذا التتبّع
#  فتُقرأ الأوامر مقطّعة: جرّبناه فخرجت أخطاء مثل «'te' is not recognized»
#  و«'/SC' is not recognized» — نصفُ سطر schtasks يُنفَّذ كأمر مستقل.
#  الأسوأ أنه لا يفشل بوضوح: بعض المهام تُنشأ وبعضها لا، بلا رسالة تقول ذلك.
#  PowerShell يقرأ UTF-8 أصلاً فلا يعاني منه، وكنّا نحتاجه أصلاً لضبط
#  السقوف الزمنية. فصار مصدراً واحداً بدل ملفَّين يتباعدان.
#
#  الاستعمال:
#    powershell -ExecutionPolicy Bypass -File schedule.ps1            # بلا نشر
#    powershell -ExecutionPolicy Bypass -File schedule.ps1 -Publish   # مع النشر
#    powershell -ExecutionPolicy Bypass -File schedule.ps1 -Publish -Check   # مقارنةٌ بالمجدول بلا تغيير
#    (أو ببساطة: schedule.bat  /  schedule-publish.bat)
# =====================================================================
param([switch]$Publish, [switch]$Check)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$vbs  = Join-Path $root 'local\run-hidden.vbs'
if (-not (Test-Path $vbs)) { throw "لم يُعثر على $vbs" }

# الدورات الأربع. كل واحدة تجيب سؤالاً مختلفاً عن «كم يتغيّر هذا فعلاً»:
#   السعر يتغيّر كل لحظة · الشمعة المكتملة لا · سلسلة العقود أبطأ ·
#   أرقام الشركة تتغيّر مرة كل ربع سنة.
#
# ‎`Start` ليست تجميلاً — بدونها تُنشأ المهام كلها بنقطة بداية واحدة هي
# لحظة تشغيل هذا السكربت، فيتصادف إطلاقها كل مرة. والأسعار تأخذ القفل
# أولاً (تنتهي في ~13 ثانية)، فالسوق والعقود **تنسحبان** — وتخرجان
# بـ‎rc=0‎ فيسجّل المجدول «نجح» وهما لم تعملا. قياس 2026-09-11: الثلاث
# مهام تُطلق في الثانية نفسها (‎16:47:00‎ + 2/10/30 دقيقة، وكلها فردية)،
# فبلغت فجوة السوق 41 دقيقة على دورة عشر دقائق، والعقود 91 دقيقة على
# دورة نصف ساعة. لا شيء في السجل يقول ذلك.
#
# الفصل بالدقيقة يكفي لأن أطول مهمة أقصر من دقيقتين:
#   الأسعار الدقائق **الزوجية** · وكل ما عداها **فردية** بإزاحات مختلفة
#   السوق  :01 :11 :21 :31 :41 :51      العقود :05 :35      اليومي 09:27
# فلا تشترك مهمتان في دقيقة واحدة أبداً. والقفل يبقى شبكة أمان للحالة
# النادرة (مهمة طالت) بدل أن يكون هو القاعدة.
# ── مطابقةٌ للمهام المسجّلة فعلاً (2026-10-03، Get-ScheduledTask) ──
# كان هذا الملفُّ متأخّراً عن المجدول: بلا Confirm ولا Publish، وMarket فيه كل 10 دقائق
# والحيّ كل 30، فإعادةُ تشغيله كانت تُسقط مهمّتين وتغيّر مواعيد ثالثة. الآن كلُّ مهمّةٍ
# بوسائطها (`Args`) وموعدها وسقفها وإعداداتها كما هي مسجّلة، و`-Check` يقارن بلا تغيير.
#   الأسهم: Confirm كل 15د عند :00 — حدّ الشمعة نفسه، وwait-bar.mjs ينتظر أدنى انتظارٍ آمن ثم
#   ظهورَ الشمعة في SIP (V4.1؛ كان :03 هامشاً ثابتاً موروثاً من ياهو) · Market كل 30د عند :20
#   النشر: Publish كل دقيقتين — بلا قفل الجلب، وهو الكاتب الوحيد لفرع data
#   الكريبتو: كل 5د من :00 — ما يقع على حدّ ربع ساعة يتحقّق من شمعة Binance المغلقة (wait-bar --crypto)
#   ثم يبني لقطة الربع ساعة وينشرها بنفسه (V4.2؛ كانت :01 ولقطته :15/:45 تنتظر مهمّة النشر)
$tasks = @(
  @{ Name='WebTrade-Quotes';    Args='quotes';             Every=2;  Start='00:00'; LimitMin=5;    Swa=$true;  Desc='أسعار فقط' }
  @{ Name='WebTrade-Confirm';   Args='confirm --publish';  Every=15; Start='00:00'; LimitMin=4320; Swa=$false; Desc='التأكيد السريع: شموع SIP ثم V3 ثم العقود' }
  @{ Name='WebTrade-Market';    Args='market --publish';   Every=30; Start='00:20'; LimitMin=20;   Swa=$true;  Desc='بقية الفريمات والأخبار وتوجّه السوق' }
  @{ Name='WebTrade-Publish';   Args='publish';            Every=2;  Start='00:01'; LimitMin=4320; Swa=$false; Desc='نشر data إلى فرع data (الكاتب الوحيد)' }
  @{ Name='WebTrade-Options';   Args='options --publish';  Every=30; Start='00:06'; LimitMin=25;   Swa=$true;  Desc='عقود الخيارات لصفحة السهم (ياهو)' }
  @{ Name='WebTrade-Filings';   Args='filings --publish';  Every=10; Start='00:07'; LimitMin=5;    Swa=$true;  Desc='إيداعات SEC — 8-K وتداول المطّلعين' }
  @{ Name='WebTrade-Daily';     Args='daily --publish';    At='09:27';              LimitMin=60;   Swa=$true;  Desc='أساسيات وترتيب وأحداث وتقويم' }
  @{ Name='WebTrade-Crypto';    Args='crypto';             Every=5;  Start='00:00'; LimitMin=4;    Swa=$true;  Desc='دفتر الكريبتو — شموع ومحرّك ولقطة فرص' }
  @{ Name='WebTrade-CryptoMon'; Args='cmon';               Every=5;  Start='00:04'; LimitMin=4;    Swa=$true;  Desc='مراقبة الكريبتو المنشور' }
  # الحراسة — بلا قفلٍ ولا شبكةٍ للجلب ولا أيّ نموذج لغوي
  @{ Name='WebTrade-Health';    Args='health';             Every=10; Start='00:09'; LimitMin=8;    Swa=$true;  Desc='صحّة المنشور ورجوعٌ آليّ عند عطبٍ تقنيّ' }
  @{ Name='WebTrade-Fortress';  Args='fortress';           At='04:13';              LimitMin=90;   Swa=$true;  Desc='الفحص الشامل الليلي' }
  @{ Name='WebTrade-Torture';   Args='torture';            At='05:43'; Day='FRI';   LimitMin=120;  Swa=$true;  Desc='تعذيبٌ أسبوعي' }
  @{ Name='WebTrade-Mutation';  Args='mutation';           At='02:43'; Day='SAT';   LimitMin=240;  Swa=$true;  Desc='اختبار الطفرات الأسبوعي' }
)

# بلا نشر (تشغيلٌ محلّي فقط): لا أسعار سريعة ولا مهمّة نشر، ووسائطٌ بلا --publish
if (-not $Publish) {
  $tasks = $tasks | Where-Object { $_.Name -notin @('WebTrade-Quotes', 'WebTrade-Publish') }
  foreach ($t in $tasks) { $t.Args = $t.Args -replace ' --publish', '' }
}

# -Check: مقارنة الملفّ بالمجدول **بلا أيّ تغيير** — الوسائط والموعد والدورة والسقف
if ($Check) {
  $diff = 0
  foreach ($t in $tasks) {
    $r = Get-ScheduledTask -TaskName $t.Name -ErrorAction SilentlyContinue
    if (-not $r) { Write-Host "  ✗ $($t.Name): غير مسجّلة"; $diff++; continue }
    $args0 = ($r.Actions | Select-Object -First 1).Arguments
    $trg = $r.Triggers | Select-Object -First 1
    $hm = ([datetime]$trg.StartBoundary).ToString('HH:mm')
    $want = @{ args = $t.Args; hm = $(if ($t.At) { $t.At } else { $t.Start }); rep = $(if ($t.Every) { "PT$($t.Every)M" } else { '' }); lim = $t.LimitMin }
    $limMin = [int]([System.Xml.XmlConvert]::ToTimeSpan($r.Settings.ExecutionTimeLimit).TotalMinutes)
    $bad = @()
    if (-not $args0.EndsWith(' ' + $want.args)) { $bad += "الوسائط '$args0'" }
    if ($hm -ne $want.hm) { $bad += "البداية $hm≠$($want.hm)" }
    if ("$($trg.Repetition.Interval)" -ne $want.rep) { $bad += "الدورة $($trg.Repetition.Interval)≠$($want.rep)" }
    if ($limMin -ne $want.lim) { $bad += "السقف $limMin≠$($want.lim)" }
    if ($r.Settings.StartWhenAvailable -ne $t.Swa) { $bad += "StartWhenAvailable" }
    if ($bad.Count) { Write-Host "  ✗ $($t.Name): $($bad -join ' · ')"; $diff++ } else { Write-Host "  ✓ $($t.Name)" }
  }
  $extra = Get-ScheduledTask -TaskName 'WebTrade-*' | Where-Object { $_.TaskName -notin $tasks.Name }
  foreach ($e in $extra) { Write-Host "  ✗ $($e.TaskName): مسجّلة وليست في الملف"; $diff++ }
  Write-Host $(if ($diff) { "  ✗ $diff اختلاف" } else { "  ✔ الملف يطابق المجدول ($($tasks.Count) مهمّة)" })
  exit $diff
}

Write-Host ""
Write-Host "  جدولة المرصد$(if ($Publish) {' — مع النشر التلقائي على GitHub'})" -ForegroundColor Cyan
Write-Host "  المجلد: $root"
Write-Host ""
foreach ($t in $tasks) {
  $when = if ($t.At) { "يومياً $($t.At)" } else { "كل $($t.Every) دقيقة من $($t.Start)" }
  Write-Host ("    {0,-18} {1,-16} {2}" -f $t.Name, $when, $t.Desc)
}
Write-Host ""
Write-Host "  المهام لا تتداخل: إزاحاتها تمنع اشتراك مهمتين في دقيقة واحدة،"
Write-Host "  والقفل في data شبكة أمان لو طالت إحداها — لأن دورتين معاً"
Write-Host "  تتجاوزان حصّة الطلبات فيبدأ المزوّد بالرفض."
if ($Publish) {
  Write-Host ""
  Write-Host "  يتطلب أن يكون المجلد مربوطاً بـ GitHub (local\link-github.bat)."
}
Write-Host ""
Read-Host "  اضغط Enter للمتابعة (أو Ctrl+C للإلغاء)" | Out-Null

# الإنشاء بـ schtasks.exe لا بـ Register-ScheduledTask: الأخيرة تحتاج
# RepetitionDuration للتكرار اللانهائي، و[TimeSpan]::MaxValue يخرج منها
# P99999999DT23H59M59S فيرفضه المجدول («قيمة خارج المدى»). schtasks
# تفهم /SC MINUTE /MO n مباشرة. ثم نضبط ما لا تعرفه schtasks عبر
# Set-ScheduledTask: السقف الزمني ومنع التداخل.
$failed = @()
foreach ($t in $tasks) {
  $jobArgs = $t.Args
  # wscript لا node مباشرة: node تطبيق كونسول، فيفتح Windows نافذة طرفية
  # مرئية مع كل تشغيل — أي كل دقيقتين مع دورة الأسعار.
  $tr = 'wscript.exe "' + $vbs + '" ' + $jobArgs
  $a = @('/Create', '/TN', $t.Name, '/TR', $tr, '/F')
  $a += if ($t.Day) { @('/SC', 'WEEKLY', '/D', $t.Day, '/ST', $t.At) }
        elseif ($t.At) { @('/SC', 'DAILY', '/ST', $t.At) }
        else       { @('/SC', 'MINUTE', '/MO', "$($t.Every)", '/ST', $t.Start) }

  $out = & schtasks.exe @a 2>&1
  if ($LASTEXITCODE -ne 0) {
    $failed += $t.Name
    Write-Host "    ✗ $($t.Name) — $out" -ForegroundColor Red
    continue
  }

  # IgnoreNew يعمل الآن فعلاً: run-hidden.vbs صار ينتظر node بدل أن
  # يخرج فوراً، فيرى المجدول التشغيل جارياً ويعرف أن يتخطّى الجديد.
  try {
    $task = Get-ScheduledTask -TaskName $t.Name
    $task.Settings.ExecutionTimeLimit = "PT$($t.LimitMin)M"
    $task.Settings.MultipleInstances  = 'IgnoreNew'
    $task.Settings.StartWhenAvailable = $t.Swa
    $task.Settings.DisallowStartIfOnBatteries = $false
    $task.Settings.StopIfGoingOnBatteries     = $false
    Set-ScheduledTask -TaskName $t.Name -Settings $task.Settings | Out-Null
    Write-Host "    ✓ $($t.Name)" -ForegroundColor Green
  } catch {
    # المهمة أُنشئت لكن إعداداتها لم تُضبط — ليست فشلاً تاماً، وقولها
    # أصدق من علامة ✓ تخفي نصف الحقيقة
    Write-Host "    ~ $($t.Name) — أُنشئت بلا ضبط السقف الزمني: $($_.Exception.Message)" -ForegroundColor Yellow
  }
}

Write-Host ""
if ($failed.Count) {
  Write-Host "  ✗ فشل إنشاء: $($failed -join '، ')" -ForegroundColor Red
  Write-Host "    جرّب فتح نافذة الأوامر كمسؤول وأعد التشغيل."
  Write-Host ""
}
Write-Host "  تم. للتحقّق:" -ForegroundColor Cyan
Write-Host "    Get-ScheduledTask -TaskName WebTrade-*"
Write-Host "  للإلغاء:"
foreach ($t in $tasks) { Write-Host "    schtasks /Delete /TN `"$($t.Name)`" /F" }
Write-Host ""
Read-Host "  اضغط Enter للإغلاق" | Out-Null
