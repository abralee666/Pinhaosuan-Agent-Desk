import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {LocalSessions,attachLocalSession} from '../lib/local-sessions.mjs';
import {executionSession} from '../lib/execution-session.mjs';
import {Store} from '../lib/store.mjs';

function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'desk-native-import-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const project=path.join(root,'project'),data=path.join(root,'data');fs.mkdirSync(project);
  fs.writeFileSync(path.join(project,'source.js'),'original');
  fs.writeFileSync(path.join(project,'.env'),'SECRET=do-not-copy');
  const thread={id:'local-thread',cwd:project,name:'本地原生项目',updatedAt:1700000000,status:{type:'notLoaded'},turns:[{id:'turn-a',status:'completed',startedAt:1700000000,items:[{id:'user-a',type:'userMessage',content:[{type:'text',text:'发布前交我审核'}]},{id:'thought-a',type:'reasoning',text:'private reasoning'},{id:'tool-a',type:'commandExecution',command:'credentials'},{id:'agent-a',type:'agentMessage',text:'已完成初步准备'}]}]};
  const calls=[],client={async start(){},async request(method,params){calls.push({method,params});if(method==='thread/list')return {data:[thread,{id:'platform-thread',cwd:path.join(data,'workspaces','a')}],nextCursor:'page2'};if(method==='thread/read')return {thread};return {thread:{id:'new-thread'}};}};
  const sessions=new LocalSessions(client,{managedRoot:data}),store=new Store(data,{empty:true});
  return {root,project,data,thread,calls,client,sessions,store};
}
test('lists native sessions with pagination and excludes managed workspaces, without resuming',async t=>{
  const {sessions,calls,thread}=fixture(t);
  const result=await sessions.list({search:'原生'});
  assert.deepEqual(result.data.map(x=>x.id),[thread.id]);assert.equal(result.nextCursor,'page2');
  assert.deepEqual(calls.map(x=>x.method),['thread/list']);assert.equal(calls[0].params.searchTerm,'原生');
  await assert.rejects(sessions.read('not-offered'),/刷新/);
  await assert.rejects(sessions.list({search:'a'.repeat(121)}),/120/);
  assert.equal((await sessions.read(thread.id)).cwd,thread.cwd);
});
test('attach loads public messages and original cwd, does not execute or copy project files, and deduplicates',async t=>{
  const {sessions,store,thread,client,project}=fixture(t);await sessions.list();const read=await sessions.read(thread.id);
  const task=attachLocalSession(store,read,{id:'account-a'});
  assert.equal(task.workspace,fs.realpathSync(project));assert.equal(task.executionMode,'read-only');assert.equal(task.networkAccess,false);
  assert.deepEqual(task.events.filter(x=>x.kind==='message').map(x=>x.text),['发布前交我审核','已完成初步准备']);
  assert.doesNotMatch(JSON.stringify(task),/private reasoning|credentials|do-not-copy/);
  assert.deepEqual(store.files(task),[]);assert.equal(store.context(task,'codex').files.length,0);
  store.writeArtifact(task,'context-latest.json','{}');assert.equal(fs.existsSync(path.join(project,'context-latest.json')),false);
  assert.equal(fs.readFileSync(path.join(project,'source.js'),'utf8'),'original');
  assert.equal(attachLocalSession(store,read,{id:'account-a'}).id,task.id);assert.equal(store.state.tasks.length,1);
  const reloaded=new Store(store.root,{empty:true});assert.equal(reloaded.task(task.id).nativeSession.threadId,thread.id);
  task.executionMode='workspace';task.networkAccess=true;
  const native=await executionSession(client,task,'codex:account-a');assert.equal(native.threadId,thread.id);
  assert.equal(native.policy.sandboxPolicy.networkAccess,true);
  const other=await executionSession(client,task,'codex:other-account');assert.equal(other.threadId,'new-thread');
});
test('active or missing project sessions cannot be attached',async t=>{
  const {sessions,thread}=fixture(t);await sessions.list();thread.status={type:'active'};
  await assert.rejects(sessions.read(thread.id),/正在执行/);thread.status={type:'idle'};thread.cwd=path.join(thread.cwd,'missing');
  await assert.rejects(sessions.read(thread.id));
});
test('paginated history is loaded through official turn API in chronological order',async t=>{
  const {sessions,thread,client}=fixture(t);await sessions.list();thread.turns=[];
  const request=client.request;client.request=async(method,params)=>method==='thread/turns/list'?{data:[{id:'new',items:[]},{id:'old',items:[]}],nextCursor:'older'}:request(method,params);
  const read=await sessions.read(thread.id);assert.deepEqual(read.turns.map(x=>x.id),['old','new']);assert.equal(read.olderHistoryAvailable,true);
});
