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
(por omissão `server/data`; pode ser p.ex. `/home/eu/org`). Na primeira execução é criado um `welcome.org`.

## Funcionalidades

- **Estrutura**: títulos aninhados, dobrar por secção (Tab) e global (Shift+Tab, `#+STARTUP`), mover/promover subárvores, focar subárvore (narrow), filtro/sparse tree por texto ou etiquetas.
- **Tarefas**: estados TODO configuráveis (`#+TODO: TODO NEXT | DONE`), prioridades, etiquetas (com herança e `#+FILETAGS`), `CLOSED` automático, repetidores (`+1w`, `++1w`, `.+1d`) com `LAST_REPEAT`, cookies `[n/m]` e `[%]`.
- **Datas**: `SCHEDULED`, `DEADLINE` com aviso (`-3d`), timestamps ativos/inativos, intervalos de horas e de datas.
- **Agenda**: dia/semana (atrasados, prazos próximos, repetições), lista global de tarefas, pesquisa de texto e por etiquetas/propriedades (sintaxe org: `a+b-c|TODO="NEXT"`, `Effort>1:00`, `/NEXT`).
- **Relógio**: clock in/out no `:LOGBOOK:`, indicador do relógio ativo, relatório semanal de tempo.
- **Captura**: tarefa, nota, evento → `inbox.org`; diário → `journal.org` com datetree.
- **Refile** para qualquer título/ficheiro e **arquivo** em `<ficheiro>_archive.org` com propriedades `ARCHIVE_*`.
- **Conteúdo**: ênfase, links (web, `file:`, `*Título`, `#custom-id`), imagens, listas (ordenadas, descrição, checkboxes clicáveis), tabelas (Tab alinha e salta de célula), blocos src/quote/example/verse/center, drawers, propriedades, notas de rodapé.
- **Edição**: edição por secção (Enter), duplo-clique no título, modo texto completo, desfazer/refazer, autosave, recarrega alterações externas ao voltar à janela.
- **Exportar**: HTML, `.org`, imprimir/PDF. Tema claro/escuro, layout para telemóvel. Atalhos: carregar em `?`.

## Não incluído

Execução de código (Babel), fórmulas de tabela (`#+TBLFM`, mostradas mas não calculadas), LaTeX, column view, habits, anexos,
exportação ODT/LaTeX, templates de captura configuráveis (estão em `client/src/org/capture.ts`).
