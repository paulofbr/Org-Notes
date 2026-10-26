# Instala a app local do Org Notes (captura + lembretes da agenda) para o utilizador atual, sem direitos de administrador.
# Os dados ficam no servidor remoto: a app fala com ele pela API, com o token pessoal.
# Uso: install.cmd [-InstallDir <pasta>]   Sem -InstallDir, pergunta a pasta (sugere a da instalação atual).
param([string]$InstallDir)
$ErrorActionPreference = 'Stop'
$src = $PSScriptRoot
$configDir = Join-Path $env:APPDATA 'orgnotes'
$configFile = Join-Path $configDir 'capture.json'
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'

# A pasta de uma instalação anterior vem do arranque automático, que aponta para o executável.
$previousExe = (Get-ItemProperty $runKey -Name 'OrgNotesCapture' -ErrorAction SilentlyContinue).OrgNotesCapture
$previous = if ($previousExe) { Split-Path -Parent $previousExe.Trim('"') } else { $null }
$suggested = if ($previous) { $previous } else { Join-Path $env:LOCALAPPDATA 'OrgNotes\capture' }
if (-not $InstallDir) {
    $InstallDir = Read-Host "Pasta de instalação [$suggested]"
    if (-not $InstallDir) { $InstallDir = $suggested }
}
$dest = [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($InstallDir.Trim().Trim('"')))

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
# A app atualiza-se sozinha nesta pasta, por isso o utilizador tem de poder escrever nela (não em Program Files sem admin).
try { [IO.File]::WriteAllText((Join-Path $dest '.write-test'), ''); Remove-Item (Join-Path $dest '.write-test') }
catch { throw "Não é possível escrever em $dest. Escolhe uma pasta tua, por exemplo $(Join-Path $env:LOCALAPPDATA 'OrgNotes\capture')." }
Copy-Item (Join-Path $src 'capture\*') $dest -Recurse -Force
# Ficheiros vindos de um zip descarregado ficam marcados como da Internet e o Windows pede confirmação ao abri-los.
Get-ChildItem $dest -Recurse -File | Unblock-File

New-Item -ItemType Directory -Force $configDir | Out-Null
$config | Add-Member -NotePropertyName Server -NotePropertyValue $server -Force
$config | ConvertTo-Json -Depth 5 | Set-Content $configFile -Encoding UTF8

# Arranque ao iniciar sessão, com o mesmo nome que a app usa em Definições > Arrancar com o Windows.
$exe = Join-Path $dest 'OrgNotes.Capture.exe'
Set-ItemProperty $runKey -Name 'OrgNotesCapture' -Value "`"$exe`""

# Mudou de pasta: a anterior deixa de ser usada (só se apaga se tiver mesmo a app).
$old = if ($previous) { [IO.Path]::GetFullPath($previous).TrimEnd('\') } else { $null }
# Nunca a pasta nova nem uma que a contenha.
if ($old -and -not ($dest.TrimEnd('\') + '\').StartsWith($old + '\', [StringComparison]::OrdinalIgnoreCase) -and (Test-Path (Join-Path $old 'OrgNotes.Capture.exe'))) {
    Remove-Item $old -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "Removida a instalação anterior em $old"
}

# Atalho no menu Iniciar para abrir o site.
$programs = [Environment]::GetFolderPath('Programs')
Set-Content (Join-Path $programs 'Org Notes.url') "[InternetShortcut]`r`nURL=$server`r`n"

Start-Process $exe -WorkingDirectory $dest

Write-Host ''
Write-Host "Instalado. O site está em $server (também em Iniciar > Org Notes)."
Write-Host 'Falta o token: no site, abre Conta e notificações, copia o token pessoal e cola-o nas Definições da app,'
Write-Host 'que abrem agora (ou no ícone da bandeja > Definições). A captura abre com Win+Alt+C e os lembretes da agenda'
Write-Host 'aparecem neste computador.'
