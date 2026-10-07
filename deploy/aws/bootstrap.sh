#!/bin/bash
# تهيئة خادم Alkongrs (Ubuntu 24.04) — تُشغَّل مرّةً بـroot، وإعادتها آمنة.
#   /srv/alkongrs/app      شجرة التشغيل (clone من المستودع المحلي) — المؤقّتات تعمل منها، وdata/ فيها
#   /srv/alkongrs/git      المستودع العاري (main · data · data-lkg · الوسوم) = بديل GitHub
#   /srv/alkongrs/www      ما يخدمه nginx: stocks → إصدار الموقع، data → إصدار البيانات
#   /srv/alkongrs/backups  نسخٌ محلية مؤقّتة قبل رفعها إلى S3
set -euo pipefail
NODE_VER="${NODE_VER:-24.18.0}"

# التوقيت: الجهاز كان على توقيت الرياض، فالخادم كذلك — المواعيد اليومية والأسبوعية وأسماء
# ملفّات السجلّ بلا تحويل. منطق السوق نفسه صريح المنطقة (America/New_York) فلا يتأثّر.
timedatectl set-timezone Asia/Riyadh
timedatectl set-ntp true

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -yq git nginx curl xz-utils unzip jq ufw unattended-upgrades logrotate ca-certificates

# Node من nodejs.org بنفس نسخة الجهاز
if ! /usr/bin/node -v 2>/dev/null | grep -q "v$NODE_VER"; then
  curl -fsSL "https://nodejs.org/dist/v$NODE_VER/node-v$NODE_VER-linux-x64.tar.xz" -o /tmp/node.tar.xz
  curl -fsSL "https://nodejs.org/dist/v$NODE_VER/SHASUMS256.txt" | grep "node-v$NODE_VER-linux-x64.tar.xz" | sed 's#  .*#  /tmp/node.tar.xz#' | sha256sum -c -
  tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1
  ln -sf /usr/local/bin/node /usr/bin/node; ln -sf /usr/local/bin/npm /usr/bin/npm; ln -sf /usr/local/bin/npx /usr/bin/npx
fi

# AWS CLI v2 (للنسخ الاحتياطي إلى S3)
if ! command -v aws >/dev/null; then
  curl -fsSL https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip -o /tmp/awscli.zip
  unzip -qo /tmp/awscli.zip -d /tmp && /tmp/aws/install --update
fi

# مستخدم الخدمة — بلا sudo
id alkongrs >/dev/null 2>&1 || useradd -m -s /bin/bash alkongrs
mkdir -p /srv/alkongrs/{app,git,www/releases,backups}
chown -R alkongrs:alkongrs /srv/alkongrs
chmod 755 /srv/alkongrs /srv/alkongrs/www

# مفتاح الدفع نفسه لمستخدم الخدمة (git push aws main من جهاز التطوير)
install -d -m 700 -o alkongrs -g alkongrs /home/alkongrs/.ssh
install -m 600 -o alkongrs -g alkongrs /home/ubuntu/.ssh/authorized_keys /home/alkongrs/.ssh/authorized_keys

# ذاكرة مبادلة 2G — الحصن الليلي (vitest + Playwright) يتجاوز الذاكرة لحظياً
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q /swapfile /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# الجدار: SSH وHTTP فقط (مجموعة الأمان تحصر 80 في CloudFront)
ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw --force enable >/dev/null

# nginx
install -m 644 "$(dirname "$0")/nginx-alkongrs.conf" /etc/nginx/sites-available/alkongrs
ln -sfn /etc/nginx/sites-available/alkongrs /etc/nginx/sites-enabled/alkongrs
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl enable --now nginx && systemctl reload nginx

# journald: سقفٌ للحجم
mkdir -p /etc/systemd/journald.conf.d
printf '[Journal]\nSystemMaxUse=500M\n' > /etc/systemd/journald.conf.d/alkongrs.conf
systemctl restart systemd-journald

# تحديثات الأمان تلقائياً، وإعادة التشغيل إن لزمت 03:30 الرياض (خارج الجلسة الأمريكية وقبل الحصن)
cat > /etc/apt/apt.conf.d/52alkongrs <<'EOF'
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "03:30";
EOF
echo "✓ bootstrap"
