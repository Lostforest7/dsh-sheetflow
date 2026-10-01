import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SheetFlowService } from '../src/core/service.ts'
export async function startPreview(options: { workspace: string; port: number; token?: string }) {
  const token = options.token ?? randomUUID(),
    service = new SheetFlowService()
  let port = options.port,
    origin = 'http://127.0.0.1:' + port
  const server = createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url ?? '/', origin).pathname
      if (req.headers.host !== `127.0.0.1:${port}`) {
        res.writeHead(403).end()
        return
      }
      if (req.method === 'GET' && ['/', '/workbench.js'].includes(pathname)) {
        const data = await readFile(path.resolve('lib', pathname === '/' ? 'workbench.html' : 'workbench.js'))
        res
          .writeHead(200, {
            'content-type': pathname === '/' ? 'text/html;charset=utf-8' : 'text/javascript;charset=utf-8',
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
          })
          .end(data)
        return
      }
      if (req.method !== 'POST' || !pathname.startsWith('/rpc/')) {
        res.writeHead(404).end()
        return
      }
      if (
        req.headers.authorization !== 'Bearer ' + token ||
        (req.headers.origin && req.headers.origin !== origin)
      ) {
        res.writeHead(403).end()
        return
      }
      let text = ''
      for await (const chunk of req) {
        text += chunk
        if (text.length > 30000) throw new Error('Request too large.')
      }
      const value = await service.execute(
        path.resolve(options.workspace),
        'local-preview',
        pathname.slice(5),
        JSON.parse(text || '{}'),
      )
      res
        .writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        .end(JSON.stringify({ ok: true, value }))
    } catch (e) {
      res
        .writeHead(400, { 'content-type': 'application/json' })
        .end(JSON.stringify({ ok: false, error: { message: e instanceof Error ? e.message : String(e) } }))
    }
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No preview address.')
  port = address.port
  origin = 'http://127.0.0.1:' + port
  return {
    url: origin + '/#' + token,
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())))
    },
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const server = await startPreview({
    workspace: process.env.SHEETFLOW_WORKSPACE ?? 'examples/month-end',
    port: Number(process.env.SHEETFLOW_PORT ?? 0),
    token: process.env.SHEETFLOW_TOKEN,
  })
  console.log('SheetFlow preview: ' + server.url)
  process.once('SIGINT', () => void server.close())
  process.once('SIGTERM', () => void server.close())
}
