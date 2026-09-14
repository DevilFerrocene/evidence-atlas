import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {ListToolsRequestSchema,CallToolRequestSchema} from '@modelcontextprotocol/sdk/types.js';
const server=new Server({name:'fixture',version:'1'},{capabilities:{tools:{}}});let calls=0;
server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[{name:'literature_read',description:'Fixture',inputSchema:{type:'object',properties:{url:{type:'string'},max_chars:{type:'number'}},required:['url']}}]}));
server.setRequestHandler(CallToolRequestSchema,async(req)=>{const article={title:'MCP round trip',url:req.params.arguments.url,text:`Fetched ${++calls}`,access_state:'full_text'};return {content:[{type:'text',text:JSON.stringify(article)}],structuredContent:article};});
await server.connect(new StdioServerTransport());
