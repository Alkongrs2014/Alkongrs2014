#!/bin/bash
# يولّد وحدات systemd (خدمة oneshot + مؤقّت) لكل سطر في jobs.tsv ويفعّلها.
#   install-units.sh          تثبيت/تحديث وتفعيل
#   install-units.sh --check  مقارنة المسجّل بالجدول بلا تغيير (مكافئ schedule.ps1 -Check)
#   install-units.sh --stop   إيقاف كل المؤقّتات (الرجوع إلى الجهاز)
# oneshot لا يبدأ نسخةً ثانية وهو يعمل = MultipleInstances=IgnoreNew، وTimeoutStartSec = السقف،
# وPersistent=true للمواعيد اليومية والأسبوعية = StartWhenAvailable بعد إعادة التشغيل.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
UNIT=/etc/systemd/system
mode="${1:-install}"
diff=0
names=()
while IFS=$'\t' read -r name cal lim args; do
  [[ -z "$name" || "$name" == \#* ]] && continue
  n="alkongrs-$(echo "$name" | tr 'A-Z' 'a-z')"
  names+=("$n")
  persist=false; [[ "$cal" != *"*:"* ]] && persist=true
  svc="[Unit]
Description=Alkongrs $name ($args)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=alkongrs
Group=alkongrs
Environment=TZ=Asia/Riyadh
ExecStart=/srv/alkongrs/app/deploy/aws/run-job.sh $args
TimeoutStartSec=${lim}min
Nice=5
"
  tmr="[Unit]
Description=Alkongrs $name timer

[Timer]
OnCalendar=$cal Asia/Riyadh
AccuracySec=1s
Persistent=$persist
Unit=$n.service

[Install]
WantedBy=timers.target
"
  case "$mode" in
    --check)
      if [[ "$(cat "$UNIT/$n.service" 2>/dev/null)" == "${svc%$'\n'}" && "$(cat "$UNIT/$n.timer" 2>/dev/null)" == "${tmr%$'\n'}" ]] \
         && systemctl is-enabled --quiet "$n.timer" && systemctl is-active --quiet "$n.timer"; then
        echo "  ✓ $n"
      else echo "  ✗ $n"; diff=$((diff+1)); fi ;;
    --stop) systemctl disable --now "$n.timer" 2>/dev/null || true; echo "  ■ $n" ;;
    *) printf '%s' "$svc" > "$UNIT/$n.service"; printf '%s' "$tmr" > "$UNIT/$n.timer" ;;
  esac
done < "$HERE/jobs.tsv"

if [[ "$mode" == "--check" ]]; then
  for t in $(systemctl list-unit-files 'alkongrs-*.timer' --no-legend | awk '{print $1}'); do
    n="${t%.timer}"; [[ " ${names[*]} " == *" $n "* ]] || [[ "$n" == alkongrs-backup ]] || { echo "  ✗ $n: مسجّل وليس في الجدول"; diff=$((diff+1)); }
  done
  echo "الفروق: $diff"; exit $((diff > 0))
fi
if [[ "$mode" == "install" ]]; then
  systemctl daemon-reload
  for n in "${names[@]}"; do systemctl enable --now "$n.timer" >/dev/null; echo "  ✓ $n"; done
fi
