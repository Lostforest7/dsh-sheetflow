import { defineConfig } from '@playwright/test'
import { existsSync } from 'node:fs'
const executablePath =
  process.env.SHEETFLOW_CHROMIUM_PATH ??
  (process.platform === 'win32' && existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe')
    ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
    : undefined)
export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './scripts/e2e-setup.ts',
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: 'http://127.0.0.1:45321',
    viewport: { width: 1440, height: 1000 },
    launchOptions: { executablePath },
    trace: 'retain-on-failure',
  },
  reporter: 'list',
})
