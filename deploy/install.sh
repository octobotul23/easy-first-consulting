#!/usr/bin/env bash
# Installs or updates the Easy First site on an Ubuntu/Debian server, beside any other site on it.
#
#   sudo bash ~/easyfirst-new/deploy/install.sh easyfirst-ae.com     (the domain; its DNS must point here)
#
# First time and every update are the same command. It never touches data/ (texts, accounts, uploads
# saved from the panel); before an update it saves a copy of data/ in /var/backups/easyfirst.
set -euo pipefail

DOMAIN="${1:-}"
APP=/var/www/easyfirst
BK=/var/backups/easyfirst
PORT=8787
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"

[ "$(id -u)" = 0 ] || { echo "Run it with sudo."; exit 1; }
# No questions from apt or from Ubuntu's "restart services?" screen (needrestart): the script decides.
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a
[ -n "$DOMAIN" ] || { echo "Write the domain after the command, e.g.: sudo bash $0 easyfirst-ae.com"; exit 1; }
case "$DOMAIN" in http*|*/*|www.*) echo "Write only the domain, without https:// and without www (e.g. easyfirst-ae.com)."; exit 1;; esac
[ -f "$SRC/server/server.mjs" ] && [ -f "$SRC/dist/index.html" ] || { echo "Unpack easyfirst-vps.tar.gz first (see the README)."; exit 1; }

echo "==> 1. Programs (nginx, Node.js 22 or newer)"
need=()
command -v nginx >/dev/null || need+=(nginx)
command -v curl >/dev/null || need+=(curl ca-certificates)
if [ ${#need[@]} -gt 0 ]; then apt-get update -qq; apt-get install -y -qq "${need[@]}" >/dev/null; fi
if ! command -v node >/dev/null || ! node -e 'process.exit(+process.versions.node.split(".")[0] >= 22 ? 0 : 1)'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
echo "    node $(node -v), $(nginx -v 2>&1)"

echo "==> 2. System user 'easyfirst' (can write only in $APP/data)"
id easyfirst >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin easyfirst

echo "==> 3. Code in $APP"
mkdir -p "$APP"
if [ -d "$APP/data" ] && [ -n "$(ls -A "$APP/data" 2>/dev/null)" ]; then
  mkdir -p "$BK"; chmod 700 "$BK"
  tar -czf "$BK/data-$STAMP.tar.gz" -C "$APP" data
  chmod 600 "$BK/data-$STAMP.tar.gz"
  ls -1t "$BK"/data-*.tar.gz | tail -n +11 | xargs -r rm -f
  echo "    copy of the content: $BK/data-$STAMP.tar.gz"
fi
if [ "$SRC" != "$APP" ]; then
  rm -rf "$APP/dist" "$APP/server" "$APP/deploy"
  tar -C "$SRC" --exclude=./data -cf - . | tar -C "$APP" -xf - --no-same-owner
fi
mkdir -p "$APP/data"
chown -R root:root "$APP"
chown -R easyfirst:easyfirst "$APP/data"
chmod 750 "$APP/data"

echo "==> 4. Service"
sed "s#__ORIGIN__#https://$DOMAIN#" "$APP/deploy/easyfirst.service" > /etc/systemd/system/easyfirst.service
systemctl daemon-reload
systemctl enable easyfirst >/dev/null 2>&1
systemctl restart easyfirst
ok=0
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS -o /dev/null "http://127.0.0.1:$PORT/"; then ok=1; break; fi
  sleep 1
done
[ $ok = 1 ] || { echo "!! The site did not start. Its messages:"; journalctl -u easyfirst -n 30 --no-pager; exit 1; }
echo "    the site answers on 127.0.0.1:$PORT"

echo "==> 5. nginx ($DOMAIN, www.$DOMAIN → $DOMAIN)"
CONF=/etc/nginx/sites-available/easyfirst
if [ -f "$CONF" ] && grep -q "server_name $DOMAIN;" "$CONF"; then
  echo "    kept as it is (with its HTTPS certificate)"
else
  sed "s#__DOMAIN__#$DOMAIN#g" "$APP/deploy/nginx.conf" > "$CONF"
  ln -sf "$CONF" /etc/nginx/sites-enabled/easyfirst
fi
nginx -t
systemctl reload nginx

echo "==> 6. HTTPS"
if [ -d "/etc/letsencrypt/live/$DOMAIN" ] && grep -q "ssl_certificate" "$CONF"; then
  echo "    already on"
else
  command -v certbot >/dev/null || { apt-get update -qq; apt-get install -y -qq certbot python3-certbot-nginx >/dev/null; }
  if certbot --nginx --redirect -d "$DOMAIN" -d "www.$DOMAIN"; then :
  elif certbot --nginx --redirect -d "$DOMAIN"; then echo "    (without www: www.$DOMAIN does not point here yet)"
  else
    echo "!! No certificate yet. Usually the DNS of $DOMAIN does not point to this server yet."
    echo "   The site works on http://$DOMAIN, but the admin panel saves only on https."
    echo "   When the DNS is ready, run the same command again."
  fi
fi

echo "==> Done: https://$DOMAIN   (admin panel: https://$DOMAIN/admin)"
cd "$APP"
if sudo -u easyfirst node server/manage.mjs list-admins 2>&1 | grep -q "No accounts yet"; then
  echo "    No account yet. Create it (the password is typed hidden):"
  echo "    cd $APP && sudo -u easyfirst node server/manage.mjs create-admin"
fi
