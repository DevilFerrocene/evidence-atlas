#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { openResearchStore } from '../packages/core/research-store.mjs';
import { WORKSPACE_DIR, RESEARCH_DIR } from '../packages/core/paths.mjs';
const [command,...args]=process.argv.slice(2);
const store=await openResearchStore(RESEARCH_DIR);
try{
 let result;
 if(command==='import'){
  const data=JSON.parse(await readFile(resolve(args[0]),'utf8'));
  result=await store.ingest(data,resolve(args[1]||dirname(args[0])));
 }else if(command==='search')result=store.search(args.join(' '));
 else if(command==='versions')result=store.versions(args[0]);
 else if(command==='sources')result=store.sources(args[0]);
 else if(command==='export'){
  const data=store.analysis(args[0]);if(!data)throw Error('Analysis not found');
  await writeFile(resolve(args[1]),JSON.stringify(data,null,2)+'\n',{flag:'wx'});result={path:resolve(args[1])};
 }else if(command==='source'){
  const source=store.source(args[0]);if(!source)throw Error('Source not found');
  if(args[1]&&source.content!==null){await writeFile(resolve(args[1]),source.content,{flag:'wx'});result={path:resolve(args[1])};}
  else result={id:source.id,metadata:JSON.parse(source.metadata),bytes:source.content?.length||0};
 }else throw Error('Usage: research-library.mjs search [query] | import paper.json [source-directory] | versions work-id | sources work-id | export analysis-id new-file.json | source source-id [new-file]');
 console.log(JSON.stringify(result,null,2));
}finally{store.close();}
