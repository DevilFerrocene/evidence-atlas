export function createLibraryManager({ language, onSelect }) {
  let papers = [], catalog = { categories: [], assignments: {} }, filter = 'all', query = '', selected = new Set(), busy = false;
  const zh = () => language() !== 'en';
  const tr = (a, b) => zh() ? a : b;
  const node = (tag, text, cls) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; };
  const button = (text, fn) => { const e = node('button', text); e.type = 'button'; e.onclick = fn; return e; };
  const dialog = node('dialog', undefined, 'library-dialog');
  dialog.setAttribute('aria-label', '文献库 / Library');
  document.body.append(dialog);
  const trigger = document.querySelector('#local-label');
  trigger.onclick = async () => {
    dialog.showModal(); render();
    try {
      const responses = await Promise.all([fetch('/api/papers'), fetch('/api/catalog')]);
      if (responses.some(r => !r.ok)) throw Error(tr('文献库读取失败', 'Could not load library'));
      [papers, catalog] = await Promise.all(responses.map(r => r.json())); render();
    } catch (error) { status.textContent = error.message; }
  };
  let status;
  async function change(action) {
    if (busy) return;
    busy = true; dialog.querySelectorAll('button, input, select').forEach(e => e.disabled = true);
    try {
      const response = await fetch('/api/catalog', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action) });
      const result = await response.json(); if (!response.ok) throw Error(result.error);
      catalog = result; if (action.type === 'delete') filter = 'all'; selected.clear(); busy = false; render();
      status.textContent = tr('已保存', 'Saved');
    } catch (error) { busy = false; dialog.querySelectorAll('button, input, select').forEach(e => e.disabled = false); status.textContent = error.message; }
  }
  function render() {
    trigger.textContent = tr('文献库 · 分类', 'Library · Categories');
    if (!dialog.open) return;
    dialog.replaceChildren();
    const header = node('header', undefined, 'library-header');
    header.append(node('h2', tr('文献库', 'Library')), button(tr('关闭', 'Close'), () => dialog.close()));
    const layout = node('div', undefined, 'library-layout'), sidebar = node('nav', undefined, 'library-categories');
    sidebar.setAttribute('aria-label', tr('论文分类', 'Paper categories'));
    const count = id => papers.filter(p => (catalog.assignments[p.id] || '') === id).length;
    for (const category of [{ id: 'all', name: tr('全部论文', 'All papers') }, { id: '', name: tr('未分类', 'Unclassified') }, ...catalog.categories]) {
      const item = button(`${category.name} · ${category.id === 'all' ? papers.length : count(category.id)}`, () => { filter = category.id; selected.clear(); render(); });
      item.setAttribute('aria-current', String(filter === category.id)); sidebar.append(item);
    }
    const form = node('form', undefined, 'category-create'), name = node('input');
    name.placeholder = tr('新分类名称', 'New category name'); name.setAttribute('aria-label', name.placeholder); name.maxLength = 60; name.required = true;
    const add = node('button', tr('新建分类', 'Create category')); add.type = 'submit';
    form.append(name, add); form.onsubmit = e => { e.preventDefault(); change({ type: 'create', name: name.value }); }; sidebar.append(form);
    const content = node('section', undefined, 'library-content');
    const search = node('input', undefined, 'library-search'); search.type = 'search'; search.placeholder = tr('搜索标题、作者、年份或 DOI', 'Search title, author, year or DOI'); search.setAttribute('aria-label', search.placeholder); search.value = query;
    content.append(search);
    const category = catalog.categories.find(c => c.id === filter);
    if (category) {
      const edit = node('form', undefined, 'category-edit'), input = node('input'); input.value = category.name; input.required = true; input.maxLength = 60; input.setAttribute('aria-label', tr('分类名称', 'Category name'));
      const save = node('button', tr('改名', 'Rename')); save.type = 'submit';
      edit.append(input, save, button(tr('删除分类', 'Delete category'), () => {
        if (confirm(tr('删除此分类？其中的论文会保留并回到未分类。', 'Delete this category? Its papers will remain in Unclassified.'))) change({ type: 'delete', categoryId: filter });
      })); edit.onsubmit = e => { e.preventDefault(); change({ type: 'rename', categoryId: filter, name: input.value }); }; content.append(edit);
    }
    const bulk = node('div', undefined, 'library-bulk'), all = node('input'); all.type = 'checkbox'; all.setAttribute('aria-label', tr('选择当前列表全部论文', 'Select all visible papers'));
    const summary = node('span'), destination = node('select'); destination.setAttribute('aria-label', tr('移入分类', 'Move to category'));
    for (const c of [{ id: '', name: tr('未分类', 'Unclassified') }, ...catalog.categories]) { const option = node('option', c.name); option.value = c.id; destination.append(option); }
    const move = button(tr('移动到', 'Move to'), () => change({ type: 'assign', paperIds: [...selected], categoryId: destination.value || null }));
    bulk.append(all, summary, destination, move); content.append(bulk);
    const list = node('div', undefined, 'library-list'); content.append(list);
    function drawList() {
      const visible = papers.filter(p => (filter === 'all' || (catalog.assignments[p.id] || '') === filter) && JSON.stringify([p.title, p.authors, p.year, p.doi]).toLocaleLowerCase().includes(query.toLocaleLowerCase()));
      selected = new Set([...selected].filter(id => visible.some(p => p.id === id)));
      const updateSelection = () => { summary.textContent = tr(`${visible.length} 篇 · 已选 ${selected.size} 篇`, `${visible.length} papers · ${selected.size} selected`); move.disabled = !selected.size || busy; all.checked = visible.length > 0 && selected.size === visible.length; all.indeterminate = selected.size > 0 && selected.size < visible.length; };
      list.replaceChildren();
      if (!visible.length) list.append(node('p', query ? tr('没有匹配的论文', 'No matching papers') : tr('这个分类还没有论文', 'No papers in this category'), 'library-empty'));
      for (const p of visible) {
        const row = node('div', undefined, 'library-row'), check = node('input'); check.type = 'checkbox'; check.checked = selected.has(p.id);
        const title = typeof p.title === 'string' ? p.title : p.title?.[language()] || p.title?.en || p.title?.zh || p.id;
        check.setAttribute('aria-label', tr('选择：', 'Select: ') + title); check.onchange = () => { if (check.checked) selected.add(p.id); else selected.delete(p.id); updateSelection(); };
        const info = node('div'); const open = button(title, () => { dialog.close(); onSelect(p.id); }); open.className = 'library-paper-title';
        const authors = Array.isArray(p.authors) ? p.authors.map(a => typeof a === 'string' ? a : a.name || '').join(', ') : '';
        info.append(open, node('p', [p.year, authors].filter(Boolean).join(' · '), 'library-meta'));
        const label = catalog.categories.find(c => c.id === catalog.assignments[p.id])?.name || tr('未分类', 'Unclassified');
        row.append(check, info, node('span', label, 'library-category-label')); list.append(row);
      }
      all.onchange = () => { selected = all.checked ? new Set(visible.map(p => p.id)) : new Set(); drawList(); }; updateSelection();
    }
    search.oninput = () => { query = search.value; drawList(); }; drawList();
    layout.append(sidebar, content); status = node('p', '', 'library-status'); status.setAttribute('role', 'status');
    dialog.append(header, layout, status);
  }
  return { render };
}
