#!/usr/bin/env bash
# Deploys (or updates) the server on a free-tier e2-micro VM on Google Cloud, at <subdomain>.duckdns.org over HTTPS.
# Usage: deploy/google-cloud.sh <duckdns-subdomain> <duckdns-token>
# Needs gcloud logged in with a project that has billing enabled (the free tier still asks for it).
# NAME and ZONE pick the VM (an existing one is reused); the free tier only covers us-west1, us-central1 and us-east1.
# TIMEZONE (default: this computer's, e.g. Europe/Lisbon) sets the VM's clock for the ntfy reminders.
set -euo pipefail
[ $# = 2 ] || { echo "Uso: $0 <subdomínio-duckdns> <token-duckdns>"; exit 1; }
sub=$1 token=$2 domain=$1.duckdns.org
name=${NAME:-org-notes} zone=${ZONE:-us-central1-a} tag=org-notes
tz=${TIMEZONE:-$(timedatectl show -p Timezone --value)}
root=$(cd "$(dirname "$0")/.." && pwd)
pkg=OrgNotes-server-linux-x64

"$root/deploy/package.sh"

if ! gcloud compute instances describe "$name" --zone "$zone" >/dev/null 2>&1; then
  gcloud compute instances create "$name" --zone "$zone" --machine-type e2-micro \
    --image-family debian-12 --image-project debian-cloud --boot-disk-size 30GB --boot-disk-type pd-standard --tags "$tag"
else
  gcloud compute instances add-tags "$name" --zone "$zone" --tags "$tag"
fi
gcloud compute firewall-rules describe "$tag-web" >/dev/null 2>&1 \
  || gcloud compute firewall-rules create "$tag-web" --allow tcp:80,tcp:443 --target-tags "$tag"

ip=$(gcloud compute instances describe "$name" --zone "$zone" --format 'get(networkInterfaces[0].accessConfigs[0].natIP)')
# Caddy can only get its certificate once the name points at the VM.
[ "$(curl -fsS "https://www.duckdns.org/update?domains=$sub&token=$token&ip=$ip")" = OK ] || { echo "O DuckDNS recusou o subdomínio ou o token."; exit 1; }
echo "$domain -> $ip"

gcloud compute scp "$root/dist/$pkg.zip" "$name:~" --zone "$zone" --quiet
# The VM keeps this computer's time zone, so the ntfy reminders go out at the user's hours. A cron job keeps
# DuckDNS pointing at the VM, whose address may change after a restart.
gcloud compute ssh "$name" --zone "$zone" --quiet --command "set -e
  sudo timedatectl set-timezone '$tz'
  sudo apt-get update -qq && sudo apt-get install -y -qq unzip cron curl
  rm -rf $pkg && unzip -q $pkg.zip && sudo ./$pkg/install.sh $domain
  echo '*/5 * * * * root curl -fsS \"https://www.duckdns.org/update?domains=$sub&token=$token\" >/dev/null' | sudo tee /etc/cron.d/duckdns >/dev/null"
echo "Pronto: https://$domain"
