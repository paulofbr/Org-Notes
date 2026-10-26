#!/usr/bin/env bash
# Builds the two packages into dist/: the server (site and API) for a Linux machine, and the local app
# (capture and agenda reminders) for each user's Windows computer. `package.sh server` builds only the server's.
set -euo pipefail
only=${1:-}
root=$(cd "$(dirname "$0")/.." && pwd)
out=$root/dist
server=$out/OrgNotes-server-linux-x64
client=$out/OrgNotes-client-win-x64
rm -rf "$server" "$server.zip"

(cd "$root/client" && npm run build)
(cd "$root/server" && dotnet publish -c Release -r linux-x64 --self-contained -o "$server/server")
# Users' notes and settings never go in the package.
rm -rf "$server/server/data"
cp "$root/deploy/linux-server/install.sh" "$root/deploy/linux-server/LEIA-ME.txt" "$server/"
chmod +x "$server/install.sh"

find "$server" -name '*.pdb' -delete
(cd "$out" && zip -qr9 "$(basename "$server").zip" "$(basename "$server")")
ls -lh "$server.zip"
[ "$only" = server ] && exit 0

rm -rf "$client" "$client.zip"
(cd "$root/capture" && dotnet publish -c Release -r win-x64 --self-contained -o "$client/capture")
cp "$root/deploy/windows-client/"{install.ps1,install.cmd,LEIA-ME.txt} "$client/"
find "$client" -name '*.pdb' -delete
(cd "$out" && zip -qr9 "$(basename "$client").zip" "$(basename "$client")")
ls -lh "$client.zip"
