// Integration fixture only: runs the real DSH host against a local scripted Messages endpoint.
// No DeepSeek credentials or remote model calls are used.
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { readFile, writeFile, mkdir, cp } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from '@playwright/test'
const root = path.resolve('work'),
  home = process.env.SHEETFLOW_SMOKE_HOME ?? path.join(root, 'dsh-home'),
  project = path.join(root, 'dsh-project'),
  cli = process.env.SHEETFLOW_DSH_CLI ?? path.resolve('node_modules/@deepseek-ai/dsh/lib/bin.js')
await mkdir(project, { recursive: true })
await cp('examples/month-end', project, { recursive: true })
await writeFile(
  path.join(home, 'profiles/web/cordis.patch.yml'),
  '- id: llm-deepseek\n  config:\n    baseURL: http://127.0.0.1:45324/v1\n    apiKeyEnv: SHEETFLOW_SMOKE_KEY\n    thinking: disabled\n- id: session-title-llm\n  disabled: true\n',
)
const recipe = JSON.parse(await readFile('examples/month-end/recipe.json', 'utf8')),
  requests = []
const stub = createServer(async (req, res) => {
  let raw = ''
  for await (const c of req) raw += c
  if (req.url !== '/v1/messages') {
    res.writeHead(404).end()
    return
  }
  const body = JSON.parse(raw),
    names = (body.tools ?? []).map((t) => t.name),
    messages = JSON.stringify(body.messages)
  requests.push({ tools: names, bytes: raw.length })
  const done = messages.includes('sheetflow-propose-test'),
    inspected = messages.includes('sheetflow-inspect-test'),
    tool = inspected ? 'sheetflow_propose_recipe' : 'sheetflow_inspect'
  if (!done && !names.includes(tool)) {
    res
      .writeHead(400, { 'content-type': 'application/json' })
      .end(
        JSON.stringify({
          error: { type: 'invalid_request_error', message: 'Fixture cannot see tool ' + tool },
        }),
      )
    return
  }
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`)
  send('message_start', {
    message: {
      id: 'msg-sheetflow-test',
      type: 'message',
      role: 'assistant',
      model: 'deepseek-flash',
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 0 },
    },
  })
  if (done) {
    send('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
    send('content_block_delta', {
      index: 0,
      delta: {
        type: 'text_delta',
        text: 'Local scripted integration fixture submitted a recipe. This is not a real model quality test.',
      },
    })
  } else {
    send('content_block_start', {
      index: 0,
      content_block: {
        type: 'tool_use',
        id: inspected ? 'sheetflow-propose-test' : 'sheetflow-inspect-test',
        name: tool,
        input: {},
      },
    })
    send('content_block_delta', {
      index: 0,
      delta: {
        type: 'input_json_delta',
        partial_json: JSON.stringify(
          inspected ? { recipeJson: JSON.stringify(recipe) } : { path: 'orders.xlsx', headerRow: 1 },
        ),
      },
    })
  }
  send('content_block_stop', { index: 0 })
  send('message_delta', {
    delta: { stop_reason: done ? 'end_turn' : 'tool_use', stop_sequence: null },
    usage: { output_tokens: 40 },
  })
  send('message_stop', {})
  res.end()
})
await new Promise((resolve) => stub.listen(45324, '127.0.0.1', resolve))
const host = spawn(process.execPath, [cli, 'web', '--no-open', '--port', '45323'], {
  cwd: project,
  windowsHide: true,
  env: {
    ...process.env,
    DSH_HOME: home,
    SHEETFLOW_SMOKE_KEY: 'local-test-only',
    PATH: path.dirname(process.execPath) + path.delimiter + process.env.PATH,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let logs = ''
const ready = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('DSH startup timeout. ' + logs.slice(-3000))), 45000)
  function data(chunk) {
    logs += chunk.toString()
    const match = logs.match(/http:\/\/127\.0\.0\.1:45323\/[^\s]*/)
    if (match) {
      clearTimeout(timer)
      resolve(match[0].replace(/\x1b\[[0-9;]*m/g, ''))
    }
  }
  host.stdout.on('data', data)
  host.stderr.on('data', data)
  host.once('exit', (code) => {
    clearTimeout(timer)
    reject(new Error('DSH exited ' + code + ' ' + logs.slice(-5000)))
  })
})
let browser
try {
  const url = await ready
  await writeFile(path.join(root, 'dsh-auth-url.txt'), url)
  browser = await chromium.launch({
    executablePath:
      process.env.SHEETFLOW_CHROMIUM_PATH ??
      (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined),
    headless: true,
  })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
    errors = []
  let activeSession
  page.on('request', (req) => {
    if (req.url().endsWith('/api/dsh-sheetflow')) activeSession = req.postDataJSON()?.payload?.sessionId
  })
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(url)
  await page
    .getByText('继续', { exact: true })
    .click({ timeout: 1500 })
    .catch(() => {})
  await page
    .getByText('稍后配置', { exact: true })
    .click({ timeout: 1500 })
    .catch(() => {})
  const session = await page.evaluate(async (project) => {
    async function rpc(method, request) {
      return (
        await fetch('/api/' + method, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            type: 'client-request',
            rpcId: crypto.randomUUID(),
            method,
            payload: { args: { request } },
          }),
        })
      ).json()
    }
    const ws = await rpc('workspace/create', { path: project })
    if (!ws.result.ok) throw new Error(JSON.stringify(ws))
    const s = await rpc('session/create', { workspaceId: ws.result.value.workspace.workspaceId })
    if (!s.result.ok) throw new Error(JSON.stringify(s))
    await rpc('session/rename', {
      sessionId: s.result.value.sessionId,
      title: 'DSH SheetFlow integration smoke',
    })
    return s.result.value.sessionId
  }, project)
  await page.reload()
  await page
    .getByText('稍后配置', { exact: true })
    .click({ timeout: 1500 })
    .catch(() => {})
  await page.getByRole('button', { name: '选择工作区', exact: true }).click()
  await page.getByText('dsh-project', { exact: true }).last().click()
  await page
    .getByRole('tree', { name: '会话' })
    .getByText('dsh-project', { exact: true })
    .click()
    .catch(() => {})
  await page.getByRole('button', { name: '▦ SheetFlow 填表台', exact: true }).click()
  await page.getByRole('button', { name: '载入样例规则', exact: true }).click()
  await page.getByLabel('AI instructions').fill('Suggest the exact sample mapping for review.')
  await page.getByRole('button', { name: '请求 AI 建议', exact: true }).click()
  const proposal = await page.evaluate(async (session) => {
    for (let i = 0; i < 40; i++) {
      const r = await (
        await fetch('/api/dsh-sheetflow', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            type: 'client-request',
            rpcId: crypto.randomUUID(),
            method: 'dsh-sheetflow',
            payload: { sessionId: session, operation: 'proposal', args: {} },
          }),
        })
      ).json()
      if (r.result?.ok && r.result.value) return r.result.value
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    return null
  }, activeSession ?? session)
  if (!proposal) throw new Error('Scripted model tool did not submit a proposal. ' + JSON.stringify(requests))
  await page.getByRole('button', { name: '读取建议', exact: true }).click()
  await page.getByLabel('Confirm rules').check()
  await page.getByRole('button', { name: '生成预览 →', exact: true }).click()
  for (const key of ['00002', '00003', '00004', '00005', '00006', '00008']) {
    await page.getByLabel('Acknowledge ' + key, { exact: true }).click()
    await page.waitForFunction(
      (key) => document.querySelector('input[aria-label="Acknowledge ' + key + '"]')?.checked,
      key,
    )
  }
  await page.getByRole('button', { name: '导出模板副本', exact: true }).click()
  await page.getByRole('button', { name: '已导出', exact: true }).waitFor()
  if (await page.getByRole('button', { name: '▦ SheetFlow 填表台', exact: true }).isVisible())
    await page.getByRole('button', { name: '▦ SheetFlow 填表台', exact: true }).click()
  if (!(await page.getByRole('button', { name: '已导出', exact: true }).isVisible())) {
    await page.getByRole('button', { name: /03\s*运行记录/ }).click()
    await page.getByRole('button', { name: '打开记录', exact: true }).first().click()
    await page.getByRole('button', { name: '已导出', exact: true }).waitFor()
  }
  await page.locator('.sf-overlay').evaluate((el) => (el.scrollTop = 0))
  await page.screenshot({ path: 'docs/assets/dsh-integration.png', fullPage: true })
  if (errors.length) throw new Error(errors.join('\n'))
  await writeFile(
    'work/dsh-smoke-result.json',
    JSON.stringify(
      {
        at: new Date().toISOString(),
        dshVersion: '0.2.0-rc.2',
        transport: 'real DSH Web host / local scripted model',
        modelQualityTest: false,
        requests: requests.length,
        tools: ['sheetflow_inspect', 'sheetflow_propose_recipe'],
        proposal: !!proposal,
        exported: true,
        runtimeErrors: errors,
      },
      null,
      2,
    ),
  )
  console.log(
    'PASS: actual DSH launcher, session RPC, inspect/proposal tool calls, review and export. Local scripted endpoint; no real model used.',
  )
} catch (e) {
  await writeFile('work/dsh-smoke-host.log', logs)
  if (browser) {
    const pages = browser.contexts().flatMap((c) => c.pages())
    for (const p of pages) {
      console.error((await p.locator('body').innerText()).slice(-6000))
      await p.screenshot({ path: 'work/dsh-smoke-failed.png' })
    }
  }
  throw e
} finally {
  await browser?.close()
  host.kill()
  await new Promise((resolve) => stub.close(resolve))
}
