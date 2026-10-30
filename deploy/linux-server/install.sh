#!/usr/bin/env bash
# Installs (or updates) the Org Notes server — site and API — on a Debian/Ubuntu machine, as a systemd service.
# Usage: sudo ./install.sh [domain]   With a domain, Caddy serves it over HTTPS (automatic certificate);
#                                      without one, the server listens on port 5080 over plain HTTP.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Corre como root: sudo $0 [domínio]"; exit 1; }
src=$(cd "$(dirname "$0")" && pwd)
domain=${1:-}
app=/opt/org-notes
data=/var/lib/org-notes

# .NET needs ICU, which minimal images may lack (the package name carries its version).
if ! ldconfig -p | grep -q libicuuc; then
  apt-get update -qq && apt-get install -y -qq "$(apt-cache search --names-only '^libicu[0-9]+$' | cut -d' ' -f1 | sort -V | tail -1)"
fi
id org-notes >/dev/null 2>&1 || useradd -r -m -d "$data" -s /usr/sbin/nologin org-notes
systemctl stop org-notes 2>/dev/null || true
mkdir -p "$app"
cp -a "$src/server/." "$app/"
chmod +x "$app/OrgNotes.Server"
# The local settings hold the allowed emails and the AI key: readable by the service only.
[ -f "$app/appsettings.Local.json" ] && chown root:org-notes "$app/appsettings.Local.json" && chmod 640 "$app/appsettings.Local.json"

if [ -n "$domain" ]; then urls=http://localhost:5080; else urls=http://0.0.0.0:5080; fi
# The address the phone's reminders open (without a domain the server cannot know its own; they then have no link).
public=${domain:+https://$domain}
cat > /etc/systemd/system/org-notes.service <<UNIT
[Unit]
Description=Org Notes (site and API)
After=network.target

[Service]
User=org-notes
WorkingDirectory=$app
ExecStart=$app/OrgNotes.Server
Environment=OrgDirectory=$data
Environment=Urls=$urls
Environment=PublicUrl=$public
Restart=always

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now org-notes

if [ -n "$domain" ]; then
  command -v caddy >/dev/null || { apt-get update && apt-get install -y caddy; }
  if ! grep -q "^$domain " /etc/caddy/Caddyfile 2>/dev/null; then
    printf '\n%s {\n  reverse_proxy localhost:5080\n}\n' "$domain" >> /etc/caddy/Caddyfile
  fi
  systemctl reload caddy
  echo "Instalado: https://$domain"
else
  echo "Instalado: http://$(hostname -I | awk '{print $1}'):5080"
  echo "Sem domínio, a ligação não é cifrada: usa-o só numa rede de confiança, ou volta a correr com: sudo $0 <domínio>"
fi
echo "Notas em $data/users/<email>/. Configuração em $app/appsettings.Local.json (emails autorizados e IA)."
