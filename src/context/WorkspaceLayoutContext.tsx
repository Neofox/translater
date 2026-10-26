import { createContext, useContext } from 'react'

export type WorkspaceLayout = {
  mode: 'stack' | 'split' | 'book' | 'laptop'
  resultFirst: boolean
  desktop: boolean
  tight: boolean
}

export const COMPACT_LAYOUT: WorkspaceLayout = {
  mode: 'stack',
  resultFirst: true,
  desktop: false,
  tight: false,
}

export const WorkspaceLayoutContext = createContext(COMPACT_LAYOUT)
export const useWorkspaceLayoutContext = () =>
  useContext(WorkspaceLayoutContext)
