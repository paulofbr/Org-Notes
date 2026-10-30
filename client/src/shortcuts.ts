import { useEffect } from 'react'
import { tr } from './i18n'

// Single source of truth for the shortcut bar and the help dialog.

export type ShortcutContext = 'row' | 'doc' | 'editor' | 'source' | 'agenda' | 'agendaRow' | 'global'

// A third element `false` keeps a shortcut out of the bottom bar (it stays in the ? help).
export const SHORTCUTS: Record<ShortcutContext, { title: string; keys: [string, string, false?][] }> = {
  row: {
    title: tr('Título selecionado'),
    keys: [
      ['Tab', tr('Dobrar')],
      ['↑ ↓', tr('Navegar')],
      ['Enter', tr('Editar secção')],
      ['F2', tr('Editar título')],
      ['t', tr('Estado')],
      ['Shift+← →', tr('Estado anterior/seguinte')],
      ['Shift+↑ ↓', tr('Prioridade'), false],
      ['s', tr('Agendar')],
      ['d', tr('Prazo')],
      ['q', tr('Etiquetas')],
      ['p', tr('Propriedades'), false],
      ['r', tr('Editar ficha (ficheiros com formulário)'), false],
      ['e', tr('Descrição')],
      ['l', tr('Link ou imagem')],
      ['a', tr('Anexar ficheiros')],
      ['i / o', tr('Relógio iniciar/parar')],
      ['Ctrl+Enter', tr('Novo irmão')],
      ['Ctrl+Shift+Enter', tr('Novo filho'), false],
      ['Alt+↑ ↓', tr('Mover')],
      ['Alt+← →', tr('Promover/despromover'), false],
      ['w', tr('Refile')],
      ['$', tr('Arquivar')],
      ['n / Esc', tr('Focar / mostrar tudo'), false],
      [tr('Espaço'), tr('Marcar checkbox')],
      ['Delete', tr('Apagar'), false],
    ],
  },
  doc: {
    title: tr('Documento'),
    keys: [
      ['↓', tr('Selecionar primeiro título')],
      ['Shift+Tab', tr('Visibilidade global')],
      ['f', tr('Filtrar')],
      ['m', tr('Estrutura / Texto')],
      ['Ctrl+Z / Ctrl+Y', tr('Desfazer / refazer'), false],
    ],
  },
  editor: {
    title: tr('A editar secção'),
    keys: [
      ['Ctrl+Enter', tr('Guardar')],
      ['Esc', tr('Cancelar')],
      ['Tab', tr('Alinhar tabela / próxima célula')],
      ['Alt+Enter', tr('Novo item ou título')],
      ['Ctrl+L', tr('Link ou imagem')],
      ['Alt+R', tr('IA: desenvolver texto')],
      ['Alt+Shift+R', tr('IA: só corrigir'), false],
    ],
  },
  source: {
    title: tr('Modo texto'),
    keys: [
      ['Esc', tr('Voltar à estrutura')],
      ['Tab', tr('Alinhar tabela / próxima célula')],
      ['Alt+Enter', tr('Novo item ou título')],
      ['Ctrl+L', tr('Link ou imagem')],
    ],
  },
  agenda: {
    title: tr('Agenda'),
    keys: [
      ['1–5', tr('Dia · Semana · Tarefas · Procurar · Relógio')],
      ['b / f', tr('Anterior / seguinte')],
      ['.', tr('Hoje')],
      ['j k / ↑ ↓', tr('Navegar')],
    ],
  },
  agendaRow: {
    title: tr('Item da agenda'),
    keys: [
      ['Enter', tr('Abrir')],
      ['e', tr('Editar')],
      ['t', tr('Estado')],
      ['Shift+← →', tr('Estado anterior/seguinte')],
      ['j k / ↑ ↓', tr('Navegar')],
      ['Esc', tr('Sair da lista')],
    ],
  },
  global: {
    title: tr('Global'),
    keys: [
      ['c', tr('Capturar')],
      ['a', tr('Agenda')],
      ['/', tr('Procurar')],
      ['Ctrl+K', tr('Comandos e ficheiros')],
      ['[', tr('Minimizar / expandir menu')],
      ['?', tr('Todos os atalhos')],
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
