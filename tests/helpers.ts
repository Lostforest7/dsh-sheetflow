import { cp, readFile, mkdtemp } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { RecipeSchema } from '../src/shared/model.ts'
import { readBook } from '../src/core/workbook.ts'
export async function fixture(name = 'month-end') {
  const dir = path.resolve('examples', name),
    recipe = RecipeSchema.parse(JSON.parse(await readFile(path.join(dir, 'recipe.json'), 'utf8')))
  const [orders, settlements, template] = await Promise.all(
    ['orders.xlsx', 'settlements.xlsx', 'template.xlsx'].map(async (file) =>
      readBook(await readFile(path.join(dir, file)), file),
    ),
  )
  return { recipe, orders, settlements, template, dir }
}
export async function workspace(name = 'month-end') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sheetflow-test-'))
  await cp(path.resolve('examples', name), root, { recursive: true })
  return root
}
