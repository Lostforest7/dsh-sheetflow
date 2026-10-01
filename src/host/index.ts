import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-session-query'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import { z } from 'zod'
import { SheetFlowService } from '../core/service.ts'
import { FlowError } from '../shared/model.ts'
export const name = 'dsh-sheetflow'
export const inject = ['connection', 'sessionQuery', 'tools']
const Request = z.object({
  type: z.literal('client-request'),
  rpcId: z.string().min(1).max(200),
  method: z.literal('dsh-sheetflow'),
  payload: z.object({
    sessionId: z.string().min(1).max(200),
    operation: z.string().max(40),
    args: z.unknown(),
  }),
})
export function apply(ctx: Context): void {
  const service = new SheetFlowService()
  async function run(session: SessionId, op: string, args: unknown, signal?: AbortSignal) {
    using obs = await ctx.sessionQuery.observeSession(session, { projectionMode: 'none', signal })
    const root = obs.header.cwd
    if (!root) throw new FlowError('no-workspace', 'Choose a DSH session with a local workspace.')
    return service.execute(root, session, op, args, signal)
  }
  ctx.connection.fetch.register({
    path: '/api/dsh-sheetflow',
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (incoming) => {
      let rpcId = 'invalid-request'
      try {
        const req = Request.parse(await incoming.json())
        rpcId = req.rpcId
        return Response.json(
          {
            type: 'server-response',
            rpcId,
            result: {
              ok: true,
              value: await run(
                req.payload.sessionId as SessionId,
                req.payload.operation,
                req.payload.args,
                incoming.signal,
              ),
            },
          },
          { headers: { 'cache-control': 'no-store' } },
        )
      } catch (e) {
        return Response.json(
          {
            type: 'server-response',
            rpcId,
            result: {
              ok: false,
              error: {
                code: e instanceof FlowError ? e.code : 'sheetflow/failed',
                message: e instanceof Error ? e.message : String(e),
                details: {},
              },
            },
          },
          { headers: { 'cache-control': 'no-store' } },
        )
      }
    },
  })
  function sessionOf(exec: ToolRunContext): SessionId {
    if (!exec.agent) throw new FlowError('no-agent', 'This tool requires a current DSH agent session.')
    return exec.agent.session.id
  }
  ctx.tools.register(
    defineTool({
      name: 'sheetflow_inspect',
      description:
        'Inspect a relative workspace XLSX/CSV file for SheetFlow mapping. Returns the requested headerRow and bounded sampleRows with absolute worksheet row numbers. Use those row numbers; never count nonempty rows to infer a header position. Inspect the exact source header row again before proposing a recipe. Does not modify the file.',
      parameters: { path: { type: 'string', required: true }, headerRow: { type: 'integer' } },
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      async execute(args, exec) {
        return (await run(
          sessionOf(exec),
          'describe',
          { path: args.path, headerRow: args.headerRow ?? 1 },
          exec.signal,
        )) as any
      },
    }),
  )
  ctx.tools.register(
    defineTool({
      name: 'sheetflow_propose_recipe',
      description:
        'Propose a SheetFlow schemaVersion 1 recipe for human review. Does not run, approve or export it. Use the exact recipe JSON structure supplied by the SheetFlow request, preserving confirmed headers; recipeJson is a JSON string.',
      parameters: { recipeJson: { type: 'string', required: true } },
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      async execute(args, exec) {
        if (args.recipeJson.length > 20000) throw new FlowError('body-limit', 'Recipe is too large.')
        return (await run(sessionOf(exec), 'propose', JSON.parse(args.recipeJson), exec.signal)) as any
      },
    }),
  )
}
