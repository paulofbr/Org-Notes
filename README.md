# Org Notes

Org-mode na web: **React + TypeScript** (Vite) no frontend, **ASP.NET Core (.NET 10)** no backend.
Os ficheiros são `.org` normais guardados numa pasta, por isso continuam compatíveis com o Emacs.

## Correr

```bash
# produção (um só processo)
cd client && npm install && npm run build   # gera server/wwwroot
cd ../server && dotnet run                  # http://localhost:5080

# desenvolvimento (hot reload)
cd server && dotnet run
cd client && npm run dev                    # http://localhost:5173 (proxy /api -> 5080)

# testes do núcleo org
cd client && npm test
```

A pasta dos ficheiros é configurada em `server/appsettings.json` → `OrgDirectory`
(por omissão `server/data`; pode ser p.ex. `/home/eu/org`). Cada utilizador tem os seus ficheiros em `<OrgDirectory>/users/<email>/`;
para cada novo utilizador são criados `todo.org`, `agenda.org`, `notes.org`, `contacts.org` e `archive.org`.

## Notificações da agenda

O servidor avisa mesmo com o site fechado: N minutos antes de cada item com hora (`SCHEDULED`, `DEADLINE`,
timestamps ativos, incluindo repetições), um resumo diário (hoje, atrasados, prazos próximos) e, à hora do resumo,
um aviso por cada prazo (`DEADLINE`) a 7, 3, 1 e 0 dias (`DeadlineReminders`). Dois canais:

- **ntfy**: cada utilizador tem um tópico secreto, que vê e liga/desliga em *Conta e notificações* (sino no menu).
  Recebe na app ntfy (Android/iOS) ou no PC com `ntfy subscribe <url>`. Desligado por omissão.
- **Nativo** (`notify-send` no Linux, toast no Windows): mostra na máquina onde o servidor corre. Ligado por omissão
  só no modo de um utilizador.

Configuração em `appsettings.json` → `Notifications` (`MinutesBefore`, `DailySummaryAt`, `DeadlineReminders`, `NtfyServer`, `Native`, `Enabled`).

## App de captura (atalho global, sem browser)

`capture/` é uma pequena app (.NET + Avalonia) que fica na bandeja e abre o formulário de captura com um atalho
global: escolhe o template pela tecla, escreve o título, data/hora e notas, <kbd>Ctrl+Enter</kbd> guarda, <kbd>Esc</kbd> fecha.
Usa os templates dos ficheiros e grava no servidor (`/api/capture`). Na primeira execução pede o servidor e o
token pessoal (no site: sino → *Conta e notificações*). Definições em `~/.config/orgnotes/capture.json`
ou `%APPDATA%\orgnotes\capture.json`.

```bash
# Linux
cd capture && dotnet publish -c Release -r linux-x64 --self-contained -o ~/.local/share/orgnotes-capture
# Windows (pode ser compilado no Linux)
cd capture && dotnet publish -c Release -r win-x64 --self-contained -o publish-win
```

- **Windows**: corre `OrgNotes.Capture.exe`; o atalho (por omissão <kbd>Win+Alt+C</kbd>) é registado pela app e
  *Arrancar com o Windows* está nas Definições (ícone da bandeja → Definições).
- **Linux (Hyprland/Omarchy)**: o Wayland não deixa apps registarem atalhos globais, por isso liga-se uma tecla a
  `OrgNotes.Capture --show` (acorda a instância da bandeja) e arranca-se a app com a sessão:
  ```lua
  -- ~/.config/hypr/bindings.lua
  o.bind("SUPER + ALT + C", "Org Notes capture", "/home/<eu>/.local/share/orgnotes-capture/OrgNotes.Capture --show")
  -- ~/.config/hypr/autostart.lua
  o.launch_on_start("/home/<eu>/.local/share/orgnotes-capture/OrgNotes.Capture")
  ```
  Corre via XWayland; a escala de cada monitor vem do `hyprctl` (ou fixa-se com `"Scale"` nas definições).

## Revisão de texto por IA

Na captura (site e app) e no editor de secção, o botão ✨ abre os modos de IA: **Desenvolver** (<kbd>Alt+R</kbd>:
corrige, clarifica, estrutura e desenvolve as ideias), **Corrigir** (<kbd>Alt+Shift+R</kbd>: só ortografia e gramática),
**Resumir**, **Tom profissional** e **Extrair tarefas** (checkboxes). Nunca inventa nomes, datas ou números (usa
`[definir]`). As sugestões aparecem palavra a palavra para aceitar ou descartar.
O botão só aparece com a IA configurada em `Ai`.
Põe as chaves em `server/appsettings.Local.json` (ignorado pelo git) ou em variáveis de ambiente (`Ai__ApiKey`, ...).

- **Claude** (API da Anthropic, paga à parte da subscrição): só `ApiKey` (ou `ANTHROPIC_API_KEY`); `Model` opcional
  (por omissão `claude-opus-5-5`).
- **Qualquer API compatível com OpenAI**: `BaseUrl`, `Model` e `ApiKey` (sem chave para o Ollama). `Model` aceita uma
  lista (`"gemini-3.5-flash,gemini-3.5-flash-lite"`): se um modelo esgotar a quota grátis (429) passa ao seguinte. Por exemplo:

| Fornecedor | `BaseUrl` |
|---|---|
| Google Gemini (plano grátis no AI Studio) | `https://generativelanguage.googleapis.com/v1beta/openai` |
| Groq | `https://api.groq.com/openai/v1` |
| Mistral | `https://api.mistral.ai/v1` |
| OpenRouter | `https://openrouter.ai/api/v1` |
| Ollama (local) | `http://localhost:11434/v1` |

```json
{ "Ai": { "BaseUrl": "https://generativelanguage.googleapis.com/v1beta/openai", "Model": "<modelo do AI Studio>", "ApiKey": "..." } }
```

O texto das notas é enviado ao fornecedor escolhido; nos planos grátis pode ser usado para treino (vê os termos).

## Login

O site exige sempre login e só entram os emails em `Auth:AllowedEmails` (lista vazia: ninguém entra). Por omissão
entra-se com email e password: na primeira vez, cada email autorizado escolhe a sua password em *Criar password*
(quem souber um email autorizado que ainda não tenha password pode criá-la primeiro, por isso cria a tua logo).
Ficheiros de versões antigas sem login (diretamente em `OrgDirectory`) passam para a pasta do primeiro utilizador.

Opcionalmente, botões *Entrar com Google* e *Entrar com Microsoft (Office)*, cada um ativo quando o seu `ClientId` e
`ClientSecret` estão preenchidos. O email da conta tem de estar em `AllowedEmails`. A Google e a Microsoft só aceitam HTTPS num domínio
(ou `http://localhost`).

- **Google**: [Google Cloud Console](https://console.cloud.google.com/apis/credentials) → *Create credentials* → *OAuth client ID*
  → *Web application*, com redirect URI `https://<o-teu-dominio>/signin-google`.
- **Microsoft** (contas Microsoft 365 de trabalho/escola e pessoais Outlook/Hotmail): [Entra admin center](https://entra.microsoft.com)
  → *App registrations* → *New registration*, *Accounts in any organizational directory and personal Microsoft accounts*,
  redirect URI (Web) `https://<o-teu-dominio>/signin-microsoft`; depois *Certificates & secrets* → *New client secret*.

Passa os segredos por variáveis de ambiente ou em `server/appsettings.Local.json` (fora do git), não no `appsettings.json`:
`Auth__AllowedEmails__0=eu@gmail.com`, `Auth__AllowedEmails__1=...`, `Auth__Google__ClientId`, `Auth__Google__ClientSecret`,
`Auth__Microsoft__ClientId`, `Auth__Microsoft__ClientSecret`.

### Deploy numa VPS (Debian/Ubuntu)

A Google só aceita HTTPS num domínio, por isso a app fica atrás do [Caddy](https://caddyserver.com) (certificado automático)
e escuta só em `localhost:5080`.

```bash
# na tua máquina: compilar e copiar
cd client && npm run build && cd ../server && dotnet publish -c Release -r linux-x64 --self-contained -o publish
rsync -a publish/ root@vps:/opt/org-notes/

# na VPS
apt install caddy
echo 'notas.exemplo.pt { reverse_proxy localhost:5080 }' > /etc/caddy/Caddyfile && systemctl reload caddy
useradd -r -m -d /var/lib/org-notes org-notes
cat > /etc/systemd/system/org-notes.service <<UNIT
[Service]
User=org-notes
WorkingDirectory=/opt/org-notes
ExecStart=/opt/org-notes/OrgNotes.Server
Environment=OrgDirectory=/var/lib/org-notes
Environment=Auth__Google__ClientId=...apps.googleusercontent.com
Environment=Auth__Google__ClientSecret=...
Environment=Auth__AllowedEmails__0=eu@gmail.com
Restart=always
[Install]
WantedBy=multi-user.target
UNIT
systemctl enable --now org-notes
```

### Correr localmente com arranque automático (um utilizador, notificações nativas)

Define `Auth:AllowedEmails` com o teu email (p.ex. `Environment=Auth__AllowedEmails__0=eu@gmail.com` abaixo).

```bash
# Linux (systemd, utilizador)
cd client && npm run build && cd ../server && dotnet publish -c Release -o ~/.local/share/org-notes
cat > ~/.config/systemd/user/org-notes.service <<UNIT
[Service]
WorkingDirectory=%h/.local/share/org-notes
ExecStart=%h/.local/share/org-notes/OrgNotes.Server
Environment=OrgDirectory=%h/org
[Install]
WantedBy=default.target
UNIT
systemctl --user enable --now org-notes
```

```powershell
# Windows: tarefa que arranca ao iniciar sessão (define OrgDirectory no appsettings.json publicado)
cd server; dotnet publish -c Release -o $env:LOCALAPPDATA\OrgNotes
$a = New-ScheduledTaskAction -Execute "$env:LOCALAPPDATA\OrgNotes\OrgNotes.Server.exe" -WorkingDirectory "$env:LOCALAPPDATA\OrgNotes"
Register-ScheduledTask OrgNotes -Action $a -Trigger (New-ScheduledTaskTrigger -AtLogOn) -Settings (New-ScheduledTaskSettingsSet -ExecutionTimeLimit 0)
```

## Funcionalidades

- **Estrutura**: títulos aninhados, dobrar por secção (Tab) e global (Shift+Tab, `#+STARTUP`), mover/promover subárvores, focar subárvore (narrow), filtro/sparse tree por texto ou etiquetas.
- **Tarefas**: estados TODO configuráveis (`#+TODO: TODO NEXT | DONE`), prioridades, etiquetas (com herança e `#+FILETAGS`), `CLOSED` automático, repetidores (`+1w`, `++1w`, `.+1d`) com `LAST_REPEAT`, cookies `[n/m]` e `[%]`.
- **Datas**: `SCHEDULED`, `DEADLINE` com aviso (`-3d`), timestamps ativos/inativos, intervalos de horas e de datas.
- **Agenda**: dia/semana (atrasados, prazos próximos, repetições), lista global de tarefas, pesquisa de texto e por etiquetas/propriedades (sintaxe org: `a+b-c|TODO="NEXT"`, `Effort>1:00`, `/NEXT`).
- **Relógio**: clock in/out no `:LOGBOOK:`, indicador do relógio ativo, relatório semanal de tempo.
- **Captura**: cada ficheiro define os seus templates num bloco `#+BEGIN_CAPTURE <tecla> <nome> [:datetree]` no cabeçalho (editável em *Template de captura* no menu do ficheiro). Por omissão: tarefa → `todo.org`, evento → `agenda.org`, nota → `notes.org`, contacto → `contacts.org`. Placeholders: `%{title}`, `%{body}`, `%{when}`, `%{time}`, `%U`, `%T`.
- **Refile** para qualquer título/ficheiro e **arquivo** em `archive.org` com propriedades `ARCHIVE_*`.
- **Conteúdo**: ênfase, links (web, `file:`, `*Título`, `#custom-id`), imagens, listas (ordenadas, descrição, checkboxes clicáveis), tabelas (Tab alinha e salta de célula), blocos src/quote/example/verse/center, drawers, propriedades, notas de rodapé.
- **Edição**: edição por secção (Enter), duplo-clique no título, modo texto completo, desfazer/refazer, autosave, recarrega alterações externas ao voltar à janela.
- **Exportar**: HTML, `.org`, imprimir/PDF. Tema claro/escuro, layout para telemóvel. Atalhos: carregar em `?`.

## Não incluído

Execução de código (Babel), fórmulas de tabela (`#+TBLFM`, mostradas mas não calculadas), LaTeX, column view, habits, anexos,
exportação ODT/LaTeX.
