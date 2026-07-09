"""
خادم استقبال تنبيهات TradingView عبر Webhook
TradingView Alert Webhook Receiver

يستقبل تنبيهات TradingView على المسار /webhook ويتحقق من المفتاح السري
ثم يسجل التنبيه في ملف alerts.jsonl ليسهل البناء عليه لاحقًا
(تنفيذ أوامر تداول، إرسال إشعارات Telegram، ...).
"""

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, jsonify, request

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("tradingview-webhook")

app = Flask(__name__)

# المفتاح السري: يجب أن يطابق قيمة "secret" داخل رسالة التنبيه في TradingView
WEBHOOK_SECRET = os.environ.get("TV_WEBHOOK_SECRET", "")

# ملف تخزين التنبيهات (سطر JSON لكل تنبيه)
ALERTS_FILE = Path(__file__).parent / "alerts.jsonl"

# أقصى عدد تنبيهات تُعرض في GET /alerts
MAX_ALERTS_RETURNED = 50


def store_alert(alert: dict) -> None:
    """حفظ التنبيه في ملف alerts.jsonl مع طابع زمني."""
    record = {
        "received_at": datetime.now(timezone.utc).isoformat(),
        "alert": alert,
    }
    with ALERTS_FILE.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


def handle_alert(alert: dict) -> None:
    """
    نقطة التوسعة: نفّذ هنا ما تريده عند وصول تنبيه.

    أمثلة:
      - إرسال رسالة إلى Telegram أو Discord
      - تنفيذ أمر شراء/بيع عبر واجهة منصة التداول (بعد اختبار كافٍ!)
    """
    action = alert.get("action", "غير محدد")
    ticker = alert.get("ticker", "غير محدد")
    price = alert.get("price", "غير محدد")
    logger.info("تنبيه جديد: %s | الرمز: %s | السعر: %s", action, ticker, price)


@app.post("/webhook")
def webhook():
    """استقبال تنبيه من TradingView."""
    # TradingView يرسل الرسالة كنص خام، وقد لا يضبط ترويسة Content-Type
    payload = request.get_json(force=True, silent=True)
    if payload is None:
        logger.warning("طلب مرفوض: الجسم ليس JSON صالحًا")
        return jsonify({"ok": False, "error": "invalid JSON body"}), 400

    if not WEBHOOK_SECRET:
        logger.error("TV_WEBHOOK_SECRET غير معيّن — ارفض جميع الطلبات حتى يتم ضبطه")
        return jsonify({"ok": False, "error": "server secret not configured"}), 500

    if payload.get("secret") != WEBHOOK_SECRET:
        logger.warning("طلب مرفوض: مفتاح سري غير صحيح من %s", request.remote_addr)
        return jsonify({"ok": False, "error": "unauthorized"}), 403

    # لا نخزن المفتاح السري مع التنبيه
    alert = {k: v for k, v in payload.items() if k != "secret"}

    store_alert(alert)
    handle_alert(alert)

    return jsonify({"ok": True})


@app.get("/alerts")
def list_alerts():
    """عرض آخر التنبيهات المستلمة."""
    if not ALERTS_FILE.exists():
        return jsonify({"count": 0, "alerts": []})

    with ALERTS_FILE.open(encoding="utf-8") as f:
        lines = f.readlines()

    alerts = [json.loads(line) for line in lines[-MAX_ALERTS_RETURNED:]]
    return jsonify({"count": len(alerts), "alerts": alerts})


@app.get("/health")
def health():
    """فحص حالة الخادم."""
    return jsonify({"status": "ok", "secret_configured": bool(WEBHOOK_SECRET)})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8080"))
    if not WEBHOOK_SECRET:
        logger.warning(
            "تحذير: لم يتم تعيين TV_WEBHOOK_SECRET — "
            "سيرفض الخادم جميع التنبيهات حتى تعيينه."
        )
    app.run(host="0.0.0.0", port=port)
