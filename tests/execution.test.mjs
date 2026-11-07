import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {executionMode,executionPolicy,executionSettings} from '../lib/execution.mjs';
import {Store} from '../lib/store.mjs';
test('execution defaults to read-only and rejects unknown permissions',()=>{
  assert.equal(executionMode(),'read-only');assert.throws(()=>executionMode('unknown'));
  assert.deepEqual(executionPolicy({workspace:'X'}).sandboxPolicy,{type:'readOnly'});
});
test('workspace execution preserves native restrictions across providers',()=>{
  const policy=executionPolicy({workspace:'X',executionMode:'workspace'});
  assert.deepEqual(policy.sandboxPolicy,{type:'workspaceWrite',writableRoots:['X'],networkAccess:false});
  assert.deepEqual(policy.antigravityArgs,['--mode','accept-edits','--sandbox']);
  assert.ok(!policy.antigravityArgs.includes('--dangerously-skip-permissions'));
});
test('full access is explicit, survives continuation and maps to real provider permissions',()=>{
  assert.equal(executionMode('full-access'),'full-access');
  const settings=executionSettings({executionMode:'full-access'});
  assert.deepEqual(settings,{executionMode:'full-access',networkAccess:true});
  assert.deepEqual(executionSettings({},settings),settings);
  const policy=executionPolicy({...settings,workspace:'X'});
  assert.equal(policy.sandbox,'danger-full-access');
  assert.deepEqual(policy.sandboxPolicy,{type:'dangerFullAccess'});
  assert.deepEqual(policy.antigravityArgs,['--mode','auto','--dangerously-skip-permissions']);
  assert.match(policy.instructions,/工作区外/);
  assert.match(policy.instructions,/上传、发布和审核/);
  assert.equal(executionPolicy({workspace:'X'}).sandbox,'read-only');
});
test('network access requires explicit workspace consent and survives a continuation',()=>{
  assert.deepEqual(executionSettings({}),{executionMode:'read-only',networkAccess:false});
  assert.deepEqual(executionSettings({executionMode:'read-only',networkAccess:true}),{executionMode:'read-only',networkAccess:false});
  const enabled=executionSettings({executionMode:'workspace',networkAccess:true});
  assert.deepEqual(executionSettings({},enabled),enabled);
  assert.equal(executionSettings({networkAccess:false},enabled).networkAccess,false);
  assert.equal(executionSettings({executionMode:'read-only'},enabled).networkAccess,false);
  assert.throws(()=>executionSettings({networkAccess:'true'}));
  const policy=executionPolicy({...enabled,workspace:'X'});
  assert.equal(policy.sandboxPolicy.networkAccess,true);
  assert.match(policy.instructions,/允许为当前任务访问网络/);
  assert.match(policy.instructions,/上传、发布和审核/);
  assert.doesNotMatch(policy.instructions,/禁止访问网络|只读对话/);
});
test('Windows transient file locks are retried without replacing atomic saves with direct writes', {skip:process.platform!=='win32'},()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'desk-save-test-')),store=new Store(root,{empty:true});
  const rename=fs.renameSync;let attempts=0;
  try{
    fs.renameSync=(...args)=>{attempts++;if(attempts<=2)throw Object.assign(new Error('temporary lock'),{code:'EPERM'});return rename(...args);};
    store.state.selectedTaskId='persisted';store.save();assert.equal(attempts,3);assert.equal(JSON.parse(fs.readFileSync(store.file,'utf8')).selectedTaskId,'persisted');
  }finally{fs.renameSync=rename;fs.rmSync(root,{recursive:true,force:true});}
});
test('handoff includes nested text outputs and permissions but excludes binary and local settings',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'desk-workspace-test-'));
  try{
    const store=new Store(root,{empty:true}),task=store.createTask('test','live');task.executionMode='workspace';task.networkAccess=true;
    fs.mkdirSync(path.join(task.workspace,'src'));fs.writeFileSync(path.join(task.workspace,'src','main.js'),'export const result = 207;');
    fs.writeFileSync(path.join(task.workspace,'.env'),'SECRET=private');fs.writeFileSync(path.join(task.workspace,'binary.png'),Buffer.from([0,255,0]));
    fs.mkdirSync(path.join(task.workspace,'node_modules'));fs.writeFileSync(path.join(task.workspace,'node_modules','x.js'),'excluded');
    const pack=store.context(task,'antigravity');assert.equal(pack.executionMode,'workspace');assert.equal(pack.networkAccess,true);assert.deepEqual(pack.files.map(f=>f.name),['src/main.js']);
    assert.equal(store.checkpoint(task,'codex').files[0].sha256,pack.files[0].sha256);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('read-only execution passes sandbox without plan mode to avoid plan model requirement',()=>{
  const policy=executionPolicy({workspace:'X',executionMode:'read-only'});
  assert.deepEqual(policy.antigravityArgs,['--sandbox']);
  assert.ok(!policy.antigravityArgs.includes('--mode'));
});
