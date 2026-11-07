import {test} from 'node:test';
import assert from 'node:assert/strict';
import {executionSession} from '../lib/execution-session.mjs';

function fixture(){
  const calls=[];let count=0;
  const client={async request(method,params){calls.push({method,params});return {thread:{id:'thread-'+(++count)}};}};
  const task={workspace:'X',executionMode:'read-only',threads:{codex:'legacy-readonly'},events:[{text:'上传前交用户审核'}],completed:['plan']};
  return {calls,client,task};
}
test('legacy sessions migrate and each permission change starts a clean native session',async()=>{
  const {calls,client,task}=fixture();
  const migrated=await executionSession(client,task,'codex');
  assert.equal(migrated.reason,'permissions');assert.equal(calls[0].method,'thread/start');
  assert.equal((await executionSession(client,task,'codex')).threadId,migrated.threadId);
  assert.equal(calls.at(-1).method,'thread/resume');
  task.executionMode='workspace';
  const writable=await executionSession(client,task,'codex');
  assert.notEqual(writable.threadId,migrated.threadId);assert.equal(calls.at(-1).method,'thread/start');
  assert.doesNotMatch(calls.at(-1).params.developerInstructions,/这是 Agent Desk 只读对话/);
  assert.match(calls.at(-1).params.developerInstructions,/旧的权限说明/);
  task.networkAccess=true;
  const online=await executionSession(client,task,'codex');
  assert.notEqual(online.threadId,writable.threadId);assert.equal(online.policy.sandboxPolicy.networkAccess,true);
  task.networkAccess=false;
  const offline=await executionSession(client,task,'codex');
  assert.notEqual(offline.threadId,writable.threadId);assert.notEqual(offline.threadId,online.threadId);
  task.executionMode='read-only';
  const readonly=await executionSession(client,task,'codex');
  assert.deepEqual(readonly.policy.sandboxPolicy,{type:'readOnly'});
  assert.deepEqual(task.completed,['plan']);assert.equal(task.events[0].text,'上传前交用户审核');
  const restored=JSON.parse(JSON.stringify(task));
  assert.equal((await executionSession(client,restored,'codex')).threadId,readonly.threadId);
  assert.equal(calls.at(-1).method,'thread/resume');
  assert.equal(task.threadHistory[0].threadId,'legacy-readonly');
});
test('failed rotation preserves the old mapping and auth failures never silently start new sessions',async()=>{
  const {client,task}=fixture();
  await executionSession(client,task,'codex');
  const old=JSON.stringify(task);
  client.request=async()=>{throw Error('401 unauthorized');};
  await assert.rejects(executionSession(client,task,'codex'),/401/);
  assert.equal(JSON.stringify(task),old);
  task.executionMode='workspace';
  await assert.rejects(executionSession(client,task,'codex'),/401/);
  assert.equal(task.threads.codex,JSON.parse(old).threads.codex);
});
test('missing native session recovers using the current policy',async()=>{
  const {client,task}=fixture();await executionSession(client,task,'codex');
  const request=client.request;
  client.request=async(method,params)=>{if(method==='thread/resume')throw Error('thread not found');return request(method,params);};
  assert.equal((await executionSession(client,task,'codex')).reason,'missing');
});

test('an imported thread owned by another client is never forked or force-interrupted',async()=>{
 const {task,client,calls}=fixture();task.nativeSession={source:'local',accountId:'local',threadId:'desktop-source'};
 client.request=async(method,params)=>{calls.push({method,params});throw Error('thread desktop-source already has an active writer');};
 await assert.rejects(executionSession(client,task,'codex:local'),/原生会话写入权.*占用/);
 assert.deepEqual(calls.map(c=>c.method),['thread/resume']);assert.equal(task.nativeSession.threadId,'desktop-source');assert.equal(task.threads['codex:local'],undefined);
});
