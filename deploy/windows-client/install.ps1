# Instala a app local do Org Notes (captura + lembretes da agenda) para o utilizador atual, sem direitos de administrador.
# Os dados ficam no servidor remoto: a app fala com ele pela API, com o token pessoal.
$ErrorActionPreference = 'Stop'
$src = $PSScriptRoot
$dest = Join-Path $env:LOCALAPPDATA 'OrgNotes\capture'
$configDir = Join-Path $env:APPDATA 'orgnotes'
$configFile = Join-Path $configDir 'capture.json'
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'

$config = if (Test-Path $configFile) { Get-Content $configFile -Raw -Encoding UTF8 | ConvertFrom-Json } else { New-Object PSObject }
$current = if ($config.Server) { $config.Server } else { 'https://' }
$server = Read-Host "Endereço do servidor Org Notes [$current]"
if (-not $server) { $server = $current }
$server = $server.Trim().TrimEnd('/')

Write-Host "A instalar em $dest"
Get-Process OrgNotes.Capture -ErrorAction SilentlyContinue | Stop-Process -Force
# Uma instalação antiga corria também o servidor nesta máquina: agora ele é remoto.
Get-Process OrgNotes.Server -ErrorAction SilentlyContinue | Stop-Process -Force
Remove-ItemProperty $runKey -Name 'OrgNotesServer' -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

New-Item -ItemType Directory -Force $dest | Out-Null
Copy-Item (Join-Path $src 'capture\*') $dest -Recurse -Force
# Ficheiros vindos de um zip descarregado ficam marcados como da Internet e o Windows pede confirmação ao abri-los.
Get-ChildItem $dest -Recurse -File | Unblock-File

New-Item -ItemType Directory -Force $configDir | Out-Null
$config | Add-Member -NotePropertyName Server -NotePropertyValue $server -Force
$config | ConvertTo-Json -Depth 5 | Set-Content $configFile -Encoding UTF8

# Arranque ao iniciar sessão, com o mesmo nome que a app usa em Definições > Arrancar com o Windows.
$exe = Join-Path $dest 'OrgNotes.Capture.exe'
Set-ItemProperty $runKey -Name 'OrgNotesCapture' -Value "`"$exe`""

# Atalho no menu Iniciar para abrir o site.
$programs = [Environment]::GetFolderPath('Programs')
Set-Content (Join-Path $programs 'Org Notes.url') "[InternetShortcut]`r`nURL=$server`r`n"

Start-Process $exe -WorkingDirectory $dest

Write-Host ''
Write-Host "Instalado. O site está em $server (também em Iniciar > Org Notes)."
Write-Host 'Falta o token: no site, abre Conta e notificações, copia o token pessoal e cola-o nas Definições da app,'
Write-Host 'que abrem agora (ou no ícone da bandeja > Definições). A captura abre com Win+Alt+C e os lembretes da agenda'
Write-Host 'aparecem neste computador.'
