import {test} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {ConversationHistory,historyTools} from '../lib/conversation-history.mjs';
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'desk-history-test-')),dataFile=path.join(root,'state.json');
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.writeFileSync(dataFile,JSON.stringify({membership:{license:'SECRET-LICENSE'},tasks:[{id:'task-a',goal:'上传前审核',workspace:'X',createdAt:'2026-10-22',events:[{id:'1',actor:'user',kind:'message',text:'开源部署方案',at:'2026-10-22'},{id:'2',actor:'codex',kind:'tool_result',text:'SECRET-TOOL'},{id:'3',actor:'codex',kind:'message',text:'a'.repeat(6500),at:'2026-10-22'}]},{id:'task-b',goal:'其他任务',workspace:'Y',createdAt:'2026-10-21',events:[]}]}));
  const calls=[],localClient={async start(){},async request(method,params){calls.push({method,params});if(method==='thread/list')return {data:[{id:'native-a',name:'本地标题',cwd:'Z',preview:'本地摘要',updatedAt:1}],nextCursor:null};if(method==='thread/read')return {thread:{id:'native-a',name:'本地标题',cwd:'Z'}};if(method==='thread/turns/list')return {data:[{startedAt:1,items:[{id:'u',type:'userMessage',content:[{type:'text',text:'本地用户消息'}]},{id:'r',type:'reasoning',text:'SECRET-THOUGHT'},{id:'x',type:'commandExecution',aggregatedOutput:'SECRET-CMD'},{id:'a',type:'agentMessage',text:'本地回复'}]}],nextCursor:null};throw Error(method);}};
  return {root,dataFile,calls,localClient,history:new ConversationHistory({dataFile,localClient})};
}
test('search is bounded, paginated, read-only and exposes only public summaries',async t=>{
  const {history,calls}=fixture(t);let result=await history.search({query:'开源'});
  assert.equal(result.results[0].id,'platform:task-a');assert.match(result.results[0].snippet,/开源/);assert.equal(calls.length,0);
  assert.doesNotMatch(JSON.stringify(result),/SECRET/);
  result=await history.search({source:'all',limit:1});assert.equal(result.results[0].source,'platform');
  result=await history.search({source:'all',limit:1,cursor:result.nextCursor});assert.equal(result.results[0].source,'platform');
  result=await history.search({source:'all',limit:1,cursor:result.nextCursor});assert.equal(result.results[0].id,'local:native-a');assert.equal(result.nextCursor,null);
  await assert.rejects(history.search({limit:100}),/1至20/);await assert.rejects(history.search({source:'credentials'}));
});
test('long visible messages can be read fully in chunks without tools, credentials or thought data',async t=>{
  const {history,calls}=fixture(t);let result=await history.read({conversationId:'platform:task-a',limit:2});
  assert.equal(result.messages[0].text.length,2000);assert.equal(result.messages[1].offset,2000);
  let text=result.messages.map(m=>m.text).join('');
  while(result.nextCursor){result=await history.read({conversationId:'platform:task-a',limit:2,cursor:result.nextCursor});text+=result.messages.map(m=>m.text).join('');}
  assert.equal(text,'a'.repeat(6500)+'开源部署方案');assert.equal(calls.length,0);assert.doesNotMatch(text,/SECRET/);
  const native=await history.read({conversationId:'local:native-a'});assert.deepEqual(native.messages.map(m=>m.text),['本地回复','本地用户消息']);assert.doesNotMatch(JSON.stringify(native),/SECRET/);
  assert.ok(calls.every(c=>['thread/read','thread/turns/list'].includes(c.method)));
  await assert.rejects(history.read({conversationId:'local:../../auth.json'}));
  await assert.rejects(history.call('send_message',{}),/只支持搜索和读取/);
});
test('MCP stdio protocol advertises read-only tools and serves searches without a model turn',async t=>{
  const {root,dataFile}=fixture(t),script=fileURLToPath(new URL('../scripts/history-mcp.mjs',import.meta.url));
  const child=spawn(process.execPath,[script,dataFile,root],{windowsHide:true,stdio:['pipe','pipe','pipe']});let output='';child.stdout.on('data',b=>output+=b);
  t.after(()=>child.kill());
  child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05'}})+'\n');
  child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/list'})+'\n');
  child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'search_conversations',arguments:{query:'开源'}}})+'\n');
  const end=Date.now()+5000;while(!output.includes('platform:task-a')&&Date.now()<end)await new Promise(r=>setTimeout(r,20));
  const rows=output.trim().split('\n').map(x=>JSON.parse(x));assert.equal(rows.find(x=>x.id===2).result.tools.length,2);
  assert.equal(JSON.parse(rows.find(x=>x.id===3).result.content[0].text).results[0].id,'platform:task-a');
  assert.ok(historyTools.every(tool=>tool.annotations.readOnlyHint));assert.doesNotMatch(output,/SECRET/);
  child.stdin.end();await new Promise(resolve=>child.once('exit',resolve));
});
