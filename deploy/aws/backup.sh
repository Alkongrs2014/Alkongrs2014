#!/bin/bash
# نسخة احتياطية يومية إلى S3 (alkongrs-backups-<حساب>): المستودع الكامل (الشيفرة + data + data-lkg + الوسوم)
# وحالة التشغيل التي لا تُعاد من الشبكة (حالة المحرّكات، مخزن SIP، ذاكرة العقود، الأرشيف، التدقيق).
# .env لا يُنسخ هنا — المفاتيح في SSM Parameter Store (/alkongrs/env) مشفّرةً.
set -euo pipefail
BUCKET="${ALKONGRS_BACKUP_BUCKET:?}"
TS=$(date -u +%Y%m%dT%H%M%SZ)
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
git -C /srv/alkongrs/git/alkongrs.git bundle create "$T/alkongrs-$TS.bundle" --all
tar -C /srv/alkongrs/app -czf "$T/state-$TS.tgz" \
  --exclude='data/.run.lock' --exclude='data/.publish.lock' --exclude='data/crypto/.run.lock' \
  data reports
aws s3 cp --only-show-errors "$T/alkongrs-$TS.bundle" "s3://$BUCKET/daily/$TS/"
aws s3 cp --only-show-errors "$T/state-$TS.tgz" "s3://$BUCKET/daily/$TS/"
echo "✓ $TS → s3://$BUCKET/daily/$TS/ ($(du -sh "$T" | cut -f1))"
