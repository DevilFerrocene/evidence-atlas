import { readFile, writeFile, rename, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export class CatalogError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
export function createCatalog(dataDir) {
  const directory = resolve(dataDir, '..');
  const file = resolve(directory, 'catalog.json');
  let queue = Promise.resolve();
  async function read() {
    try { return JSON.parse(await readFile(file, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return { categories: [], assignments: {} }; throw error; }
  }
  function update(action, paperIds) {
    const result = queue.then(async () => {
      await mkdir(directory, { recursive: true });
      const lock = resolve(directory, '.catalog-lock');
      try { await mkdir(lock); } catch (error) { if (error.code === 'EEXIST') throw new CatalogError('分类正在保存，请稍后重试。', 409); throw error; }
      let temporary;
      try {
        const catalog = await read();
        const category = catalog.categories.find(item => item.id === action.categoryId);
        if (['create', 'rename'].includes(action.type)) {
          const name = typeof action.name === 'string' ? action.name.trim() : '';
          if (!name || name.length > 60) throw new CatalogError('分类名称须为 1–60 个字符。');
          if (catalog.categories.some(item => item.name.toLocaleLowerCase() === name.toLocaleLowerCase() && item.id !== action.categoryId)) throw new CatalogError('这个分类名称已经存在。', 409);
          if (action.type === 'create') catalog.categories.push({ id: randomUUID(), name });
          else { if (!category) throw new CatalogError('分类不存在。', 404); category.name = name; }
        } else if (action.type === 'delete') {
          if (!category) throw new CatalogError('分类不存在。', 404);
          catalog.categories = catalog.categories.filter(item => item.id !== category.id);
          for (const [id, value] of Object.entries(catalog.assignments)) if (value === category.id) delete catalog.assignments[id];
        } else if (action.type === 'assign') {
          if (!Array.isArray(action.paperIds) || !action.paperIds.length || action.paperIds.some(id => !paperIds.has(id))) throw new CatalogError('请选择文献库中的论文。');
          if (action.categoryId !== null && !category) throw new CatalogError('分类不存在。', 404);
          for (const id of action.paperIds) {
            if (category) Object.defineProperty(catalog.assignments, id, { value: category.id, enumerable: true, configurable: true, writable: true });
            else delete catalog.assignments[id];
          }
        } else throw new CatalogError('未知的分类操作。');
        temporary = `${file}.${randomUUID()}.tmp`;
        await writeFile(temporary, JSON.stringify(catalog, null, 2) + '\n');
        await rename(temporary, file);
        return catalog;
      } finally { if (temporary) await rm(temporary, { force: true }); await rm(lock, { recursive: true, force: true }); }
    });
    queue = result.catch(() => {});
    return result;
  }
  return { read, update };
}
