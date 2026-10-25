import { createContext, useContext, type ReactNode } from 'react'
import type { OrgStore } from './store'
import type { Clock, Headline } from './org/parser'

export interface RunningClock {
  path: string
  h: Headline
  clock: Clock
}

export interface AppCtx {
  store: OrgStore
  /** Applies an edit to a file, reporting errors to the user. */
  edit: (path: string, fn: (text: string) => string) => void
  open: (path: string, line?: number) => void
  openLink: (target: string, fromPath: string) => void
  running?: RunningClock
  clockIn: (path: string, line: number) => void
  clockOut: () => void
  archive: (path: string, line: number) => void
  refile: (path: string, line: number) => void
  showDialog: (node: ReactNode) => void
  closeDialog: () => void
}

export const Ctx = createContext<AppCtx>(null!)
export const useApp = () => useContext(Ctx)
