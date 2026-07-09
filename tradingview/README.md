# الربط مع TradingView | TradingView Integration

هذا المجلد يحتوي على كل ما تحتاجه للربط مع منصة TradingView:

1. **خادم Webhook** (`webhook_server.py`) — يستقبل تنبيهات TradingView تلقائيًا.
2. **صفحة الرسم البياني** (`chart.html`) — رسم بياني مباشر مدمج من TradingView.

---

## 1) استقبال تنبيهات TradingView عبر Webhook

TradingView لا يوفر واجهة برمجية (API) عامة للتداول، لكنه يتيح إرسال **تنبيهات (Alerts)** إلى أي رابط Webhook عند تحقق شرط معين (سعر، مؤشر، استراتيجية Pine Script...). هذا الخادم يستقبل تلك التنبيهات ويسجلها، ويمكنك البناء عليه لتنفيذ أوامر تداول أو إرسال إشعارات.

> **ملاحظة:** ميزة Webhook في التنبيهات تتطلب اشتراك TradingView مدفوع (Essential أو أعلى).

### التشغيل

```bash
cd tradingview
pip install -r requirements.txt

# عيّن مفتاحًا سريًا خاصًا بك (لحماية الخادم من الطلبات الغريبة)
export TV_WEBHOOK_SECRET="اكتب-مفتاحًا-سريًا-قويًا-هنا"

python webhook_server.py
```

الخادم يعمل على المنفذ `8080`. لكي يصل إليه TradingView يجب أن يكون متاحًا على الإنترنت برابط `https` — يمكنك استخدام:

- خادم سحابي (VPS) مع نطاق و شهادة SSL، أو
- أداة نفق مثل [ngrok](https://ngrok.com): `ngrok http 8080`

### إعداد التنبيه في TradingView

1. افتح الرسم البياني في TradingView واضغط على **Alert** (التنبيه) 🔔.
2. حدد الشرط الذي تريده (تجاوز سعر، تقاطع مؤشر، إشارة استراتيجية...).
3. في تبويب **Notifications** فعّل **Webhook URL** وأدخل رابط خادمك:
   ```
   https://your-domain.com/webhook
   ```
4. في خانة **Message** ضع رسالة بصيغة JSON، مثال:

   ```json
   {
     "secret": "نفس-المفتاح-السري-الذي-عيّنته",
     "ticker": "{{ticker}}",
     "exchange": "{{exchange}}",
     "price": "{{close}}",
     "time": "{{time}}",
     "interval": "{{interval}}",
     "action": "buy"
   }
   ```

   المتغيرات مثل `{{ticker}}` و `{{close}}` يستبدلها TradingView تلقائيًا بالقيم الحقيقية عند إرسال التنبيه.

5. احفظ التنبيه. عند تحققه سيصل الطلب إلى خادمك ويُسجَّل في ملف `alerts.jsonl`.

### نقاط النهاية (Endpoints)

| المسار | الوظيفة |
|---|---|
| `POST /webhook` | استقبال تنبيهات TradingView |
| `GET /alerts` | عرض آخر التنبيهات المستلمة |
| `GET /health` | فحص حالة الخادم |

### تجربة محلية

```bash
curl -X POST http://localhost:8080/webhook \
  -H "Content-Type: application/json" \
  -d '{"secret":"مفتاحك-السري","ticker":"BTCUSDT","price":"65000","action":"buy"}'
```

---

## 2) عرض الرسوم البيانية المباشرة

افتح `chart.html` في المتصفح لعرض رسم بياني مباشر من TradingView (شارت متقدم + شريط أسعار). يمكنك تغيير الرمز الافتراضي من داخل الملف (المتغير `symbol`).

---

## تطوير لاحق (أفكار)

- ربط التنبيهات بمنصة تداول (Binance، Bybit...) لتنفيذ أوامر تلقائية.
- إرسال التنبيهات إلى Telegram أو Discord.
- حفظ التنبيهات في قاعدة بيانات وتحليلها.

⚠️ **تنبيه:** أي ربط بتنفيذ أوامر تداول حقيقية يجب اختباره أولًا على حساب تجريبي، والتداول ينطوي على مخاطر مالية.
