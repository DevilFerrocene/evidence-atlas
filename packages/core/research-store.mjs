import { DatabaseSync } from 'node:sqlite';
import { mkdir, readFile, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';

const titleText = value => typeof value === 'string' ? value : value?.en || value?.zh || '';
const identity = item => {
  const doi = String(item.doi || item.url || '').match(/10\.\d{4,9}\/[^\s?#]+/i)?.[0]?.replace(/[.,;]$/, '').toLowerCase();
  return doi ? `doi:${doi}` : `bibliography:${JSON.stringify([titleText(item.title).normalize('NFC').toLowerCase().replace(/\s+/g,' ').trim(), item.authors || '', item.year || ''])}`;
};
export async function openResearchStore(directory) {
  await mkdir(directory, { recursive: true });
  const db = new DatabaseSync(resolve(directory, 'research.sqlite'));
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS works(id TEXT PRIMARY KEY, identity TEXT UNIQUE NOT NULL, title TEXT NOT NULL, metadata TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY, work_id TEXT NOT NULL REFERENCES works(id), metadata TEXT NOT NULL, content BLOB);
    CREATE TABLE IF NOT EXISTS analyses(id TEXT PRIMARY KEY, work_id TEXT NOT NULL REFERENCES works(id), paper_id TEXT NOT NULL, created_at TEXT NOT NULL, bundle TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS analysis_sources(analysis_id TEXT REFERENCES analyses(id), source_key TEXT, source_id TEXT REFERENCES sources(id), PRIMARY KEY(analysis_id,source_key));
    CREATE TABLE IF NOT EXISTS selections(paper_id TEXT PRIMARY KEY, analysis_id TEXT REFERENCES analyses(id));
    CREATE TABLE IF NOT EXISTS retrievals(id TEXT PRIMARY KEY, lookup_key TEXT NOT NULL, score REAL NOT NULL, article TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS retrieval_lookup ON retrievals(lookup_key,score);
    CREATE INDEX IF NOT EXISTS source_work ON sources(work_id); CREATE INDEX IF NOT EXISTS analysis_work ON analyses(work_id);`);
  const work = item => {
    const key=identity(item); const existing=db.prepare('SELECT id FROM works WHERE identity=?').get(key);
    if(existing)return existing.id;
    const id=randomUUID();db.prepare('INSERT INTO works VALUES(?,?,?,?)').run(id,key,titleText(item.title),JSON.stringify(item));return id;
  };
  return {
    close:()=>db.close(),
    cacheArticle(key, article, score) {
      const text=JSON.stringify(article);
      const prior=db.prepare('SELECT id FROM retrievals WHERE lookup_key=? AND article=?').get(key,text);
      if(prior)return prior.id;
      const id=randomUUID();db.prepare('INSERT INTO retrievals VALUES(?,?,?,?)').run(id,key,score,text);return id;
    },
    cachedArticles(query='', key=null) {
      const rows=key ? db.prepare('SELECT * FROM retrievals WHERE lookup_key=? ORDER BY score DESC').all(key)
        : db.prepare('SELECT * FROM retrievals WHERE instr(lower(article),lower(?))>0 ORDER BY score DESC LIMIT 100').all(query);
      return rows.map(r=>({...r,article:JSON.parse(r.article)}));
    },
    async ingest(data, sourceDir) {
      const root=await realpath(sourceDir);const contents=new Map();
      for(const s of data.sources){
        if(!s.local_path){contents.set(s.id,null);continue;}
        const file=await realpath(resolve(root,s.local_path)), rel=relative(root,file);
        if(rel.startsWith('..')||isAbsolute(rel)||!rel)throw Error('Source outside bundle directory');
        contents.set(s.id,await readFile(file));
      }
      db.exec('BEGIN IMMEDIATE');
      try {
        const serialized=JSON.stringify(data), workId=work(data.paper);
        const prior=db.prepare('SELECT id FROM analyses WHERE work_id=? AND bundle=?').get(workId,serialized);
        if(prior){db.exec('COMMIT');return {analysis_id:prior.id,work_id:workId,reused:true};}
        const id=randomUUID();db.prepare('INSERT INTO analyses VALUES(?,?,?,?,?)').run(id,workId,data.paper.id,new Date().toISOString(),serialized);
        for(const source of data.sources){
          const wid=source.id==='source-main'?workId:work(source);
          const {local_path, id: ignored, ...metadata}=source;
          const meta=JSON.stringify(metadata), content=contents.get(source.id);
          let found=db.prepare('SELECT id,content FROM sources WHERE work_id=? AND metadata=?').all(wid,meta).find(x=>content===null?x.content===null:x.content!==null&&Buffer.from(x.content).equals(content));
          if(!found){found={id:randomUUID()};db.prepare('INSERT INTO sources VALUES(?,?,?,?)').run(found.id,wid,meta,content);}
          db.prepare('INSERT INTO analysis_sources VALUES(?,?,?)').run(id,source.id,found.id);
        }
        db.prepare('INSERT INTO selections VALUES(?,?) ON CONFLICT(paper_id) DO UPDATE SET analysis_id=excluded.analysis_id').run(data.paper.id,id);
        db.exec('COMMIT');return {analysis_id:id,work_id:workId,reused:false};
      }catch(e){db.exec('ROLLBACK');throw e;}
    },
    search(query=''){return db.prepare(`SELECT w.*, (SELECT count(*) FROM analyses a WHERE a.work_id=w.id) AS analysis_count,(SELECT count(*) FROM sources s WHERE s.work_id=w.id) AS source_count FROM works w WHERE instr(lower(w.title),lower(?))>0 OR instr(lower(w.metadata),lower(?))>0 ORDER BY w.title`).all(query,query);},
    versions(workId){return db.prepare('SELECT id,work_id,paper_id,created_at FROM analyses WHERE work_id=? ORDER BY created_at DESC').all(workId);},
    analysis(id){const row=db.prepare('SELECT bundle FROM analyses WHERE id=?').get(id);return row?JSON.parse(row.bundle):null;},
    sources(workId){return db.prepare('SELECT id,work_id,metadata,length(content) AS bytes FROM sources WHERE work_id=?').all(workId);},
    source(id){return db.prepare('SELECT * FROM sources WHERE id=?').get(id)||null;}
  };
}
