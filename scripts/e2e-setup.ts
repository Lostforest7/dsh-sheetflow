import { cp, mkdir } from 'node:fs/promises'
import { startPreview } from './dev-server.ts'
export default async function setup() {
  await mkdir('work/e2e-project', { recursive: true })
  await cp('examples/month-end', 'work/e2e-project', { recursive: true })
  const server = await startPreview({
    workspace: 'work/e2e-project',
    port: 45321,
    token: 'sheetflow-local-test',
  })
  return async () => server.close()
}
