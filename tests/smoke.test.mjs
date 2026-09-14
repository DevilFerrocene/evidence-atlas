import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Workspace } from '../agent/workspace.mjs';
import { saveArticle, findSavedArticle, readSaved } from '../agent/literature-bridge.mjs';
import { openResearchStore } from '../packages/core/research-store.mjs';
import { publishBundle } from '../packages/core/library.mjs';
import { createReaderServer } from '../apps/reader/server.mjs';

const root=await mkdtemp(tmpdir()+'/atlas-smoke-');
process.env.EVIDENCE_RESEARCH_DIR=resolve(root,'store');
test.after(async()=>{await rm(root,{recursive:true,force:true});});

test('local cache crosses workspaces and partial sources permit retrieval',async()=>{
 const a=await new Workspace(resolve(root,'a')).initialize(),b=await new Workspace(resolve(root,'b')).initialize();
 const article={title:'Smoke source',doi:'10.1234/smoke',url:'https://doi.org/10.1234/smoke',text:'Local text and reference content.',access_state:'full_text',references:[{title:'Earlier evidence'}]};
 assert.equal(await findSavedArticle(a,{url:article.url}),null);
 await saveArticle(a,article);
 const cached=await findSavedArticle(b,{url:article.url});assert.ok(cached);
 assert.match((await readSaved(b,{article_id:cached.id})).text,/Local text/);
 assert.match((await readSaved(b,{article_id:cached.id,field:'references'})).text,/Earlier evidence/);
 assert.equal(await findSavedArticle(b,{url:article.url,refresh:true}),null);
 await saveArticle(a,{...article,doi:'10.1234/partial',url:'https://doi.org/10.1234/partial',access_state:'abstract_only'});
 assert.equal(await findSavedArticle(b,{url:'https://doi.org/10.1234/partial'}),null);
});

test('analysis versions preserve source content and survive reopen',async()=>{
 const dir=resolve(root,'input');await mkdir(dir);await writeFile(resolve(dir,'original.txt'),'A complete test paragraph.');
 const fixture={paper:{id:'smoke',title:'Smoke paper',doi:'10.1234/version'},sources:[{id:'source-main',title:'Smoke paper',local_path:'original.txt'}],claims:[{id:'c1',explanation:{zh:'第一版'}}]};
 let store=await openResearchStore(process.env.EVIDENCE_RESEARCH_DIR);
 const first=await store.ingest(fixture,dir);assert.equal((await store.ingest(fixture,dir)).reused,true);
 fixture.claims[0].explanation.zh='第二版';await store.ingest(fixture,dir);store.close();
 store=await openResearchStore(process.env.EVIDENCE_RESEARCH_DIR);
 try{assert.equal(store.versions(first.work_id).length,2);assert.equal(store.analysis(first.analysis_id).claims[0].explanation.zh,'第一版');assert.equal(store.sources(first.work_id).length,1);const source=store.source(store.sources(first.work_id)[0].id);assert.equal(Buffer.from(source.content).toString(),'A complete test paragraph.');}finally{store.close();}
});

test('Python collection module parses and policy loads',()=>{
 execFileSync('python3',['-c',`import ast,json,pathlib\nr=pathlib.Path('modules/literature')\nfor p in list((r/'src').rglob('*.py'))+list((r/'browser').rglob('*.py')): ast.parse(p.read_text(),filename=str(p))\njson.loads((r/'config/publishers.json').read_text())`],{cwd:resolve('.')});
});

test('reader search returns archived analysis',async()=>{
 const dataDir=resolve(root,'reader/papers');await mkdir(dataDir,{recursive:true});
 const server=createReaderServer({port:4397,dataDir});await new Promise((ok,no)=>{server.once('error',no);server.listen(4397,'127.0.0.1',ok)});
 try{const response=await fetch('http://127.0.0.1:4397/api/research?q=Smoke');assert.equal(response.status,200);assert.ok((await response.json()).length);assert.equal((await (await fetch('http://127.0.0.1:4397/api/health')).json()).status,'ok');}finally{await new Promise(ok=>server.close(ok));}
});

test('MCP route fetches once, reuses local text, and refreshes explicitly',async()=>{
 const {Client}=await import('@modelcontextprotocol/sdk/client/index.js');
 const {StdioClientTransport}=await import('@modelcontextprotocol/sdk/client/stdio.js');
 const client=new Client({name:'smoke',version:'1'});
 const transport=new StdioClientTransport({command:process.execPath,args:['agent/literature-bridge.mjs','--workspace',resolve(root,'mcp'),'--',process.execPath,resolve('tests/fixtures/literature-upstream.mjs')],env:{...process.env},stderr:'pipe'});
 await client.connect(transport);
 try{
  const list=await client.listTools();assert.ok(list.tools.some(t=>t.name==='literature_library'));
  const call=async(extra={})=>(await client.callTool({name:'literature_read',arguments:{url:'https://doi.org/10.1234/mcp-smoke',...extra}})).structuredContent;
  const a=await call(),b=await call(),c=await call({refresh:true});
  assert.equal(a.excerpt,'Fetched 1');assert.equal(b.reused,true);assert.equal(b.excerpt,'Fetched 1');assert.equal(c.excerpt,'Fetched 2');
 }finally{await client.close();}
});

test('publication archives the complete analysis and reuses source files',async()=>{
 const dataDir=resolve(root,'published/papers');
 const options={file:resolve('examples/library/papers/einstein-1905-inertia-energy.json'),sourceDir:resolve('examples/library'),dataDir,bundledExample:true};
 const first=await publishBundle(options);
 const before=JSON.parse(await readFile(first.path,'utf8'));
 const second=await publishBundle({...options,replace:true});
 assert.equal(first.analysis_id,second.analysis_id);
 assert.deepEqual(JSON.parse(await readFile(second.path,'utf8')),before);
 const store=await openResearchStore(process.env.EVIDENCE_RESEARCH_DIR);
 try{assert.deepEqual(store.analysis(first.analysis_id),before);}finally{store.close();}
});
