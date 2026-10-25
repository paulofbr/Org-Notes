import { useEffect } from 'react'

// Single source of truth for the shortcut bar and the help dialog.

export type ShortcutContext = 'row' | 'doc' | 'editor' | 'source' | 'agenda' | 'agendaRow' | 'global'

// A third element `false` keeps a shortcut out of the bottom bar (it stays in the ? help).
export const SHORTCUTS: Record<ShortcutContext, { title: string; keys: [string, string, false?][] }> = {
  row: {
    title: 'Título selecionado',
    keys: [
      ['Tab', 'Dobrar'],
      ['↑ ↓', 'Navegar'],
      ['Enter', 'Editar secção'],
      ['F2', 'Editar título'],
      ['t', 'Estado'],
      ['Shift+← →', 'Estado anterior/seguinte', false],
      ['Shift+↑ ↓', 'Prioridade', false],
      ['s', 'Agendar'],
      ['d', 'Prazo'],
      ['q', 'Etiquetas'],
      ['p', 'Propriedades', false],
      ['i / o', 'Relógio iniciar/parar'],
      ['Ctrl+Enter', 'Novo irmão'],
      ['Ctrl+Shift+Enter', 'Novo filho', false],
      ['Alt+↑ ↓', 'Mover'],
      ['Alt+← →', 'Promover/despromover', false],
      ['w', 'Refile'],
      ['$', 'Arquivar'],
      ['n / Esc', 'Focar / mostrar tudo', false],
      ['Espaço', 'Marcar checkbox'],
      ['Delete', 'Apagar', false],
    ],
  },
  doc: {
    title: 'Documento',
    keys: [
      ['↓', 'Selecionar primeiro título'],
      ['Shift+Tab', 'Visibilidade global'],
      ['f', 'Filtrar'],
      ['m', 'Estrutura / Texto'],
      ['Ctrl+Z / Ctrl+Y', 'Desfazer / refazer', false],
    ],
  },
  editor: {
    title: 'A editar secção',
    keys: [
      ['Ctrl+Enter', 'Guardar'],
      ['Esc', 'Cancelar'],
      ['Tab', 'Alinhar tabela / próxima célula'],
      ['Alt+Enter', 'Novo item ou título'],
    ],
  },
  source: {
    title: 'Modo texto',
    keys: [
      ['Esc', 'Voltar à estrutura'],
      ['Tab', 'Alinhar tabela / próxima célula'],
      ['Alt+Enter', 'Novo item ou título'],
    ],
  },
  agenda: {
    title: 'Agenda',
    keys: [
      ['1–5', 'Dia · Semana · Tarefas · Procurar · Relógio'],
      ['b / f', 'Anterior / seguinte'],
      ['.', 'Hoje'],
      ['j k / ↑ ↓', 'Navegar'],
    ],
  },
  agendaRow: {
    title: 'Item da agenda',
    keys: [
      ['Enter', 'Abrir'],
      ['t', 'Estado'],
      ['j k / ↑ ↓', 'Navegar'],
      ['Esc', 'Sair da lista'],
    ],
  },
  global: {
    title: 'Global',
    keys: [
      ['c', 'Capturar'],
      ['a', 'Agenda'],
      ['/', 'Procurar'],
      ['Ctrl+K', 'Comandos e ficheiros'],
      ['[', 'Minimizar / expandir menu'],
      ['?', 'Todos os atalhos'],
    ],
  },
}

/** Registers plain-key shortcuts on the window, ignored while typing, with modifiers, or with a dialog open. */
export function useKeys(map: Record<string, () => void>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTyping(e.target) || document.querySelector('.modal') || e.ctrlKey || e.metaKey || e.altKey) return
      const fn = map[e.key]
      if (fn) (e.preventDefault(), fn())
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
}

export const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && el.matches('input:not([type=checkbox]),textarea,select,[contenteditable]')

/** Moves focus between keyboard-navigable items (headlines, visible checkboxes, agenda rows). */
export function moveFocus(dir: 1 | -1, from?: Element | null) {
  const items = [...document.querySelectorAll<HTMLElement>('.content .hl-row, .content .body li.cb > input:not(:disabled), .content .agenda-row')]
  const i = from ? items.indexOf(from as HTMLElement) : -1
  const next = items[i < 0 ? (dir === 1 ? 0 : items.length - 1) : i + dir]
  next?.focus()
  next?.scrollIntoView({ block: 'nearest' })
}
