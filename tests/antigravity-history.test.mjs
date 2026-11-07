import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {AntigravityHistory,attachAntigravitySession,publicAntigravityMessage} from '../lib/antigravity-history.mjs';
import {configureAntigravityHistory} from '../lib/antigravity-history-bridge.mjs';
import {ConversationHistory} from '../lib/conversation-history.mjs';
import {Store} from '../lib/store.mjs';
import {executionSession} from '../lib/execution-session.mjs';

const id='11111111-1111-1111-1111-111111111111';
function vi(n){const bytes=[];do{let b=n%128;n=Math.floor(n/128);if(n)b|=128;bytes.push(b);}while(n);return Buffer.from(bytes);}
const field=(n,text)=>{const b=Buffer.from(text);return Buffer.concat([vi(n*8+2),vi(b.length),b]);};
const payload=(type,text)=>Buffer.concat([vi(8),vi(type),field(type===14?19:20,Buffer.concat([field(type===14?2:8,text),field(6,'PRIVATE-REASONING')]))]);
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'desk-ag-history-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const home=path.join(root,'cli'),project=path.join(root,'project');fs.mkdirSync(path.join(home,'conversations'),{recursive:true});fs.mkdirSync(project);fs.writeFileSync(path.join(project,'.env'),'SECRET');
 const summary=new DatabaseSync(path.join(home,'conversation_summaries.db'));summary.exec('CREATE TABLE conversation_summaries(conversation_id TEXT,title TEXT,preview TEXT,workspace_uris TEXT,last_modified_time TEXT,status TEXT,not_fully_idle INTEGER)');
 summary.prepare('INSERT INTO conversation_summaries VALUES(?,?,?,?,?,?,?)').run(id,'历史测试','',JSON.stringify([pathToFileURL(project).href]),new Date().toISOString(),'CASCADE_RUN_STATUS_IDLE',0);summary.close();
 const steps=new DatabaseSync(path.join(home,'conversations',id+'.db'));steps.exec('CREATE TABLE steps(idx INTEGER,step_type INTEGER,step_format INTEGER,step_payload BLOB)');
 const insert=steps.prepare('INSERT INTO steps VALUES(?,?,?,?)');insert.run(1,14,0,payload(14,'用户消息'));insert.run(2,99,0,field(1,'PRIVATE-TOOL'));insert.run(3,15,0,payload(15,'助手消息'));steps.close();
 const history=new AntigravityHistory({home,managedRoot:path.join(root,'data')});return {root,home,project,history};
}
test('Antigravity lists and reads only public messages, paginates and rejects unsafe ids',async t=>{
 const {home,history}=fixture(t),before=fs.readFileSync(path.join(home,'conversation_summaries.db'));
 await assert.rejects(history.read(id),/刷新/);assert.equal((await history.list({search:'历史'})).data[0].id,id);
 const read=await history.read(id,{limit:1});assert.deepEqual(read.messages.map(m=>m.text),['助手消息']);assert.equal(read.nextCursor,'3');
 const older=await history.read(id,{before:3});assert.deepEqual(older.messages.map(m=>m.text),['用户消息']);assert.doesNotMatch(JSON.stringify([read,older]),/PRIVATE|SECRET/);
 assert.deepEqual(fs.readFileSync(path.join(home,'conversation_summaries.db')),before);
 await assert.rejects(history.read('../../auth.json'));await assert.rejects(history.list({cursor:'-1'}));
 assert.equal(publicAntigravityMessage({step_type:14,step_format:1}),null);
 assert.throws(()=>publicAntigravityMessage({step_type:14,step_format:0,step_payload:Buffer.from([255])}));
});
test('active or missing project conversations are not attached',async t=>{
 const {home,history,project}=fixture(t);await history.list();const db=new DatabaseSync(path.join(home,'conversation_summaries.db'));db.exec('UPDATE conversation_summaries SET not_fully_idle=1');db.close();
 await assert.rejects(history.read(id),/正在执行/);fs.renameSync(project,project+'-moved');assert.equal((await history.list()).data.length,0);await assert.rejects(history.read(id));
});
test('attach retains native Antigravity id without copying project files or using it as a Codex thread',async t=>{
 const {root,history,project}=fixture(t);await history.list();const thread=await history.read(id),store=new Store(path.join(root,'data'),{empty:true});
 const task=attachAntigravitySession(store,thread,{id:'account-a'});assert.equal(task.agent,'antigravity');assert.equal(task.threads.antigravity,id);assert.equal(task.workspace,fs.realpathSync(project));assert.equal(task.executionMode,'read-only');assert.deepEqual(store.files(task),[]);
 assert.equal(attachAntigravitySession(store,thread,{id:'account-a'}).id,task.id);assert.equal(store.state.tasks.length,1);
 const calls=[],client={request:async(method,args)=>{calls.push(method);return {thread:{id:'new-codex'}};}};assert.equal((await executionSession(client,task,'codex:account-a')).threadId,'new-codex');assert.deepEqual(calls,['thread/start']);
});
test('history tools search both native sources and paginate Antigravity messages without reasoning',async t=>{
 const {root,history}=fixture(t),dataFile=path.join(root,'state.json');fs.writeFileSync(dataFile,JSON.stringify({tasks:[]}));
 const client={start:async()=>{},request:async()=>({data:[],nextCursor:null})};const tools=new ConversationHistory({dataFile,localClient:client,antigravity:history});
 let page=await tools.search({source:'all'});assert.ok(page.nextCursor);page=await tools.search({source:'all',cursor:page.nextCursor});assert.equal(page.results[0].id,'antigravity:'+id);assert.equal(page.nextCursor,null);
 const found=await tools.search({source:'antigravity',query:'历史'});assert.equal(found.results.length,1);
 const read=await tools.read({conversationId:'antigravity:'+id,limit:1});assert.equal(read.messages[0].text,'助手消息');const older=await tools.read({conversationId:'antigravity:'+id,limit:1,cursor:read.nextCursor});assert.equal(older.messages[0].text,'用户消息');assert.doesNotMatch(JSON.stringify([read,older]),/PRIVATE/);
});
test('explicit MCP setup preserves other servers and backs up existing config',t=>{
 const {root}=fixture(t),file=path.join(root,'.gemini/config/mcp_config.json');fs.mkdirSync(path.dirname(file),{recursive:true});const original=JSON.stringify({mcpServers:{existing:{command:'example'}},other:true});fs.writeFileSync(file,original);
 const settingsFile=path.join(root,'.gemini/antigravity-cli/settings.json');fs.mkdirSync(path.dirname(settingsFile),{recursive:true});fs.writeFileSync(settingsFile,JSON.stringify({model:'existing-model',permissions:{allow:['command(git)'],deny:['write_file(.env)'],ask:['mcp(private/*)']}}));
 const result=configureAntigravityHistory({home:root,dataFile:path.join(root,'data.json'),localHome:path.join(root,'codex')});assert.equal(result.enabled,true);const next=JSON.parse(fs.readFileSync(file));assert.equal(next.other,true);assert.equal(next.mcpServers.existing.command,'example');assert.ok(next.mcpServers.agent_desk_history.args[0].endsWith('history-mcp.mjs'));
 const backup=fs.readdirSync(path.dirname(file)).find(n=>n.includes('backup'));assert.equal(fs.readFileSync(path.join(path.dirname(file),backup),'utf8'),original);
 const settings=JSON.parse(fs.readFileSync(settingsFile));assert.equal(settings.model,'existing-model');assert.deepEqual(settings.permissions.deny,['write_file(.env)']);assert.deepEqual(settings.permissions.ask,['mcp(private/*)']);assert.deepEqual(settings.permissions.allow,['command(git)','mcp(agent_desk_history/search_conversations)','mcp(agent_desk_history/read_conversation)']);
});
