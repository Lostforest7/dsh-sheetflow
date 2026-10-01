import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import type { FlowApi } from '../shared/model.ts'
import styles from './styles.css'
const style = document.createElement('style')
style.textContent = styles
document.head.append(style)
const token = location.hash.slice(1) || sessionStorage.getItem('sheetflow-preview-token') || ''
if (token) sessionStorage.setItem('sheetflow-preview-token', token)
history.replaceState(null, '', location.pathname)
const api: FlowApi = {
  async call<T>(operation: string, args: unknown = {}): Promise<T> {
    const response = await fetch('/rpc/' + operation, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
        body: JSON.stringify(args),
      }),
      result = await response.json()
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  },
}
createRoot(document.getElementById('root')!).render(<App api={api} />)
