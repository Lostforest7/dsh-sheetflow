import { useMemo, useState, useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { FlowApi } from '../shared/model.ts'
import { App } from '../ui/App.tsx'
import styles from '../ui/styles.css'
export const name = 'dsh-sheetflow-client',
  inject = ['slots', 'connection', 'sessions', 'uiSession']
declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    dshSheetFlow: unknown
  }
}
function Launcher({ ctx }: { ctx: Context }) {
  const current = ctx.uiSession.adapter.current,
    binding = useSyncExternalStore(current.subscribe, current.getSnapshot),
    session = binding.key as SessionId | undefined
  const [open, setOpen] = useState(false)
  const api = useMemo<FlowApi>(
    () => ({
      async call<T>(operation: string, args: unknown = {}): Promise<T> {
        if (!session) throw new Error('Select a project session.')
        const c = ctx.get('connection') as ConnectionHandle,
          result = await c.rpc.call('/api', 'dsh-sheetflow', { operation, sessionId: session, args })
        if (!result.ok) throw new Error(result.error.message)
        return result.value as T
      },
      async send(text) {
        if (!session) throw new Error('Select a project session.')
        await ctx.sessions.using(session, { source: 'dshSheetFlow' }, async (ref) => {
          const bound = await ref.ready
          const r = await bound.session.prompt([{ type: 'text', text }], 'queue')
          if (!r.ok) throw new Error(r.error.message)
        })
      },
    }),
    [ctx, session],
  )
  if (!session) return null
  return open ? (
    <div className="sf-overlay">
      <App key={session} api={api} onClose={() => setOpen(false)} />
    </div>
  ) : (
    <button className="sf-launch" onClick={() => setOpen(true)}>
      ▦ SheetFlow 填表台
    </button>
  )
}
export function apply(ctx: Context): void {
  ctx.effect(() => {
    const s = document.createElement('style')
    s.dataset.plugin = 'dsh-sheetflow'
    s.textContent = styles
    document.head.append(s)
    return () => s.remove()
  }, 'sheetflow styles')
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register(
      { name: 'shell.overlay', id: 'dsh-sheetflow-launcher', inject: () => ({ ctx }) },
      Launcher,
    ),
  )
}
