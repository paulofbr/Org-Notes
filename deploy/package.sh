#!/usr/bin/env bash
# Builds the two packages into dist/: the local app (capture and agenda reminders) for each user's Windows computer,
# and the server (site and API) for a Linux machine, which also serves that installer to signed-in users.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
out=$root/dist
server=$out/OrgNotes-server-linux-x64
client=$out/OrgNotes-client-win-x64
rm -rf "$server" "$client" "$server.zip" "$client.zip"

# The app compares its version (1.0.<number of commits>) with the server's to update itself.
rev=$(git -C "$root" rev-parse --short HEAD)
version=1.0.$(git -C "$root" rev-list --count HEAD)
(cd "$root/capture" && dotnet publish -c Release -r win-x64 --self-contained -p:Version="$version" -p:SourceRevisionId="$rev" -o "$client/capture")
cp "$root/deploy/windows-client/"{install.ps1,install.cmd,LEIA-ME.txt} "$client/"
find "$client" -name '*.pdb' -delete
(cd "$out" && zip -qr9 "$(basename "$client").zip" "$(basename "$client")")

(cd "$root/client" && npm run build)
(cd "$root/server" && dotnet publish -c Release -r linux-x64 --self-contained -o "$server/server")
# Users' notes and settings never go in the package.
rm -rf "$server/server/data"
mkdir -p "$server/server/downloads"
cp "$client.zip" "$server/server/downloads/"
echo "$version" > "$server/server/downloads/$(basename "$client").version"
cp "$root/deploy/linux-server/install.sh" "$root/deploy/linux-server/LEIA-ME.txt" "$server/"
chmod +x "$server/install.sh"
find "$server" -name '*.pdb' -delete
(cd "$out" && zip -qr9 "$(basename "$server").zip" "$(basename "$server")")

ls -lh "$client.zip" "$server.zip"
