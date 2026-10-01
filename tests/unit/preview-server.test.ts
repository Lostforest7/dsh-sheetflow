import { it, expect } from 'vitest'
import { startPreview } from '../../scripts/dev-server.ts'
import { workspace } from '../helpers.ts'
it('selects a free preview port and keeps RPC authentication/origin checks active', async () => {
  const server = await startPreview({ workspace: await workspace(), port: 0, token: 'local-test-token' })
  try {
    const origin = new URL(server.url).origin
    expect(new URL(server.url).port).not.toBe('0')
    expect((await fetch(origin + '/')).status).toBe(200)
    expect((await fetch(origin + '/rpc/listFiles', { method: 'POST', body: '{}' })).status).toBe(403)
    expect(
      (
        await fetch(origin + '/rpc/listFiles', {
          method: 'POST',
          headers: { authorization: 'Bearer local-test-token', origin: 'https://wrong.invalid' },
          body: '{}',
        })
      ).status,
    ).toBe(403)
    const result = await (
      await fetch(origin + '/rpc/listFiles', {
        method: 'POST',
        headers: { authorization: 'Bearer local-test-token', origin },
        body: '{}',
      })
    ).json()
    expect(result.ok).toBe(true)
    expect(result.value).toEqual(['orders.xlsx', 'settlements.xlsx', 'template.xlsx'])
  } finally {
    await server.close()
  }
})
