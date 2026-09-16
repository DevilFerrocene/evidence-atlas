import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { LOG_DIR } from '../packages/core/paths.mjs';
const query = process.argv[2] || '', rows = [];
async function visit(dir) {
  let files; try { files = await readdir(dir, {withFileTypes:true}); } catch(e) { if(e.code==='ENOENT')return;throw e; }
  for(const file of files) {
    const path=resolve(dir,file.name);
    if(file.isDirectory())await visit(path);
    else if(/\.jsonl(?:\.\d+)?$/.test(file.name)) for(const line of (await readFile(path,'utf8')).split('\n')) {
      try { const item=JSON.parse(line);if(!query || line.includes(query))rows.push(item); } catch {}
    }
  }
}
await visit(LOG_DIR);
rows.sort((a,b)=>String(a.timestamp||a.at).localeCompare(String(b.timestamp||b.at)));
for(const row of rows.slice(-100))console.log(JSON.stringify(row));
