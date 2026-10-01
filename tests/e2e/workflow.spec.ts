import { test, expect } from '@playwright/test'
import { readFile, mkdir } from 'node:fs/promises'
import { readBook } from '../../src/core/workbook.ts'

test('load mapping, review evidence and every exception, export real XLSX, reopen history', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/#sheetflow-local-test')
  await page.getByRole('button', { name: '载入样例规则', exact: true }).click()
  await expect(page.getByLabel('orders file')).toHaveValue('orders.xlsx')
  await expect(page.getByRole('button', { name: '生成预览 →', exact: true })).toBeDisabled()
  await page.getByLabel('Confirm rules').check()
  await page.getByRole('button', { name: '保存规则', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('规则已保存')
  await page.getByRole('button', { name: '生成预览 →', exact: true }).click()
  await expect(page.locator('.sf-metrics')).toContainText('需核对6')
  await expect(page.getByRole('button', { name: '导出模板副本', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '查看来源', exact: true }).nth(1).click()
  await expect(page.locator('.sf-evidence')).toContainText('orders.xlsx · Orders · 第 3 行')
  await page.locator('.sf-evidence').getByRole('button').click()
  for (const key of ['00002', '00003', '00004', '00005', '00006', '00008']) {
    await page.getByLabel('Acknowledge ' + key, { exact: true }).click()
    await expect(page.getByLabel('Acknowledge ' + key, { exact: true })).toBeChecked()
  }
  await mkdir('docs/assets', { recursive: true })
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: 'docs/assets/review-workbench.png', fullPage: true })
  const exported = page.waitForResponse((r) => r.url().endsWith('/rpc/export'))
  await page.getByRole('button', { name: '导出模板副本', exact: true }).click()
  const p = (await (await exported).json()).value
  await expect(page.getByRole('button', { name: '已导出', exact: true })).toBeDisabled()
  const book = readBook(await readFile('work/e2e-project/' + p.exported.file), 'out.xlsx')
  expect(book.sheets[0].cells.A6.value).toBe('00001')
  expect(book.sheets[0].cells.G6.formula).toContain('ISNUMBER')
  await page.getByRole('button', { name: /03\s*运行记录/ }).click()
  await page.getByRole('button', { name: '打开记录', exact: true }).first().click()
  await expect(page.getByRole('button', { name: '已导出', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'English', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Review the result before delivery' })).toBeVisible()
  expect(errors).toEqual([])
  await page.reload()
  await expect(page.getByRole('button', { name: /03\s*Run history/ })).toBeEnabled()
  await page.getByRole('button', { name: /03\s*Run history/ }).click()
  await expect(page.getByRole('button', { name: 'Open run', exact: true }).first()).toBeVisible()
})

test('rejects invalid imported JSON and works at mobile width without overflow', async ({ page }) => {
  await page.goto('/#sheetflow-local-test')
  await page.getByRole('button', { name: '高级：导入 / 导出规则 JSON', exact: true }).click()
  await page.getByLabel('Recipe JSON').fill('{"schemaVersion":99}')
  await page.getByRole('button', { name: '加载 JSON', exact: true }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('heading', { name: '把明细填进业务模板' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.getByRole('button', { name: '载入样例规则', exact: true }).click()
  await page.screenshot({ path: 'docs/assets/mobile-setup.png', fullPage: true })
})

test('keeps every record reachable when preview spans multiple pages (UI fixture)', async ({ page }) => {
  await page.route('**/rpc/preview', async (route) => {
    const response = await route.fetch(),
      body = await response.json()
    body.value.rows = Array.from({ length: 201 }, (_, i) => ({
      ...body.value.rows[1],
      id: 'ui-' + i,
      key: 'KEY-' + i,
    }))
    body.value.summary = { ...body.value.summary, rows: 201, matched: 0, exceptions: 201 }
    await route.fulfill({ response, json: body })
  })
  await page.goto('/#sheetflow-local-test')
  await page.getByRole('button', { name: '载入样例规则', exact: true }).click()
  await page.getByLabel('Confirm rules').check()
  await page.getByRole('button', { name: '生成预览 →', exact: true }).click()
  await expect(page.getByLabel('Acknowledge KEY-0', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '下一页', exact: true }).click()
  await page.getByRole('button', { name: '下一页', exact: true }).click()
  await expect(page.getByLabel('Acknowledge KEY-200', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '下一页', exact: true })).toBeDisabled()
})
