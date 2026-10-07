#!/bin/bash
# مكافئ local/run-hidden.vbs على لينكس: يشغّل `node local/run.mjs <args>` من شجرة التطبيق
# ويُلحق مخرجاته بـ data/logs/runs/YYYY-MM-DD-<job>.log (التاريخ بتوقيت الخادم = الرياض)،
# ويعيد رمز خروج node نفسه — فـsystemd يرى الفشل كما كان المجدول يراه.
APP=/srv/alkongrs/app
cd "$APP" || exit 1
LOGDIR="$APP/data/logs/runs"
mkdir -p "$LOGDIR"
job="${1:-run}"
exec >>"$LOGDIR/$(date +%F)-$job.log" 2>&1
exec /usr/bin/node "$APP/local/run.mjs" "$@"
