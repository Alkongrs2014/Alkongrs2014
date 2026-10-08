# نقل Alkongrs إلى AWS — **موقوفٌ مؤقتاً بأمر المالك (2026-10-08)**

لا يُستأنف إلا بأمرٍ صريحٍ منه. الموقع الحيّ ما زال على الجهاز + GitHub بلا أيّ تغيير.

## ما اكتمل (في هذا الفرع `alkongrs-aws` وحده)
- حصر النظام: 13 مهمّة مجدولة (`local/schedule.ps1`)، `data/` ‏776 م.ب، والنشر عبر فرع `data`
  و raw.githubusercontent/api.github.com.
- `deploy/aws/`:
  - `jobs.tsv` مرآة `schedule.ps1 -Publish` بتوقيت الرياض.
  - `install-units.sh` يولّد مؤقّتات systemd ويقارنها بـ`--check`، ويوقفها بـ`--stop`.
  - `run-job.sh` مكافئ `run-hidden.vbs` بنفس أسماء السجلّات.
  - `post-receive` خطّاف مستودعٍ عارٍ محلي: `data` تُبدَّل ذرّياً، و`main` يمرّ ببوّابة check-ui
    ثم يُبدَّل الموقع.
  - `nginx-alkongrs.conf` و`bootstrap.sh`: Ubuntu 24.04، توقيت Asia/Riyadh، Node 24.18، swap 2G، ufw.
  - `backup.sh` إلى S3 (المفاتيح في SSM لا في النسخة).
- `stocks/config.js`: github.io يقرأ raw كما كان، وغيره يقرأ `../data`. و`MOVED_TO` تحويلٌ عند القطع
  يحمل `stk_*` («صفقاتي») في `#mig=`.
- `health/verify/check-live` تقبل `SITE_URL` و`SITE_DATA_BASE`.
- `sw.js` على v72. **تنبيه:** إن تقدّم `main` برفع V فأعِد رفعها وحساب SHELL_SHA عند الدمج.
- `publish.mjs` بلا تعديل: مساره غير GitHub (git fetch/show) يعمل مع المستودع المحلي.
- اختبارات الانحدار 84/84 و check-ui 13/13 على هذا الفرع.

## قياساتٌ مأخوذة (2026-10-07/08)
- سيرفر BotTradeOne (t3.small، فرانكفورت، **لا يُلمس**): المعالج ≤ 24% ذروةً، والذاكرة ≤ 465 م.ب، والقرص 18%.
- حِمل Alkongrs من سجلّات الجهاز: ~4 ساعات تشغيل يومياً (معظمها انتظار شبكة) أي أقلّ من 9% من معالجين،
  وذاكرة ~1 ج.ب ذروةً، والحصن أكثر من 1.5 ج.ب.
- تقدير التكلفة (أسعارٌ معلنة لا فاتورة): t4g.small ‏~21$/شهر، t3.small ‏~24.5$، m7i-flex.large ‏~87$.

## المتبقّي — بالترتيب عند الاستئناف
1. قرار المالك: سيرفر مستقل (موصى: t4g.small) أم سيرفر البوت مؤقتاً (بلا حصن/طفرات/تعذيب + swap).
2. تسجيل الدخول في موصّل AWS، ثم قراءة الخطة والرصيد **قبل** إنشاء أيّ شيء.
3. ادمج `main` في هذا الفرع أوّلاً (وأعِد V/SHELL_SHA).
4. الإنشاء: EC2 + EIP في eu-central-1 (Binance يحظر الولايات المتحدة)، S3 للنسخ، CloudFront، SSM لـ`.env`.
5. `bootstrap.sh`، ثم مستودعٌ عارٍ + `post-receive`، ثم `git push` للشيفرة، ثم rsync لـ`data/` (بلا الأقفال)،
   ثم `install-units.sh`.
6. تشغيلٌ متوازٍ بلا قطع: AWS ينشر إلى مستودعه المحلي فقط (فرع `data` في GitHub كاتبُه الجهاز وحده).
   قارن summary/trades/contracts/crypto، واختبر ياهو من AWS، وأعِد التشغيل للتأكّد من العودة التلقائية.
7. القطع: `MOVED_TO` في main إلى رابط CloudFront، ثم إيقاف مهامّ الجهاز وmonitor.yml، والإبقاء عليهما للرجوع.

ذاكرة الجلسة: `alkongrs-aws-migration.md` في ذاكرة المشروع.
