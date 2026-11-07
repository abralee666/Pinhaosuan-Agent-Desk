import {attachLocalSession} from '../lib/local-sessions.mjs';
import {attachAntigravitySession} from '../lib/antigravity-history.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {Store} from '../lib/store.mjs';
import {deliveryFiles} from '../lib/delivery-files.mjs';
import {prepareCodexInput,commitCodexInput} from '../lib/codex-input.mjs';
import {executionSession} from '../lib/execution-session.mjs';
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'desk-projects-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return new Store(root,{empty:true});}
test('project chats share cwd and deliverables but retain independent histories, native threads and metadata',async t=>{
 const store=fixture(t),project=store.createProject({name:'研究',instructions:'成果放 outputs 目录'});
 const a=store.createTask('研究甲','live',{projectId:project.id}),b=store.createTask('研究乙','live',{projectId:project.id});
 assert.equal(a.workspace,b.workspace);assert.notEqual(a.storageWorkspace,b.storageWorkspace);
 store.event(a,'codex','只有甲知道的对话');fs.writeFileSync(path.join(a.workspace,'result.txt'),'shared bytes');
 assert.equal(fs.readFileSync(path.join(b.workspace,'result.txt'),'utf8'),'shared bytes');
 const pack=store.context(b,'antigravity');assert.equal(pack.project.id,project.id);assert.match(pack.memories.at(-1).text,/成果放 outputs/);assert.doesNotMatch(JSON.stringify(pack),/只有甲知道/);assert.deepEqual(pack.files,[]);
 store.writeArtifact(a,'context-latest.json','A');store.writeArtifact(b,'context-latest.json','B');assert.equal(fs.existsSync(path.join(project.workspace,'context-latest.json')),false);
 assert.equal(fs.readFileSync(path.join(a.storageWorkspace,'context-latest.json'),'utf8'),'A');
 const calls=[];const client={request:async(method,args)=>{calls.push({method,args});return {thread:{id:'native-'+calls.length}};}};
 await executionSession(client,a,'codex:one');await executionSession(client,b,'codex:one');assert.notEqual(a.threads['codex:one'],b.threads['codex:one']);assert.ok(calls.every(c=>c.args.cwd===project.workspace));
 const other=store.createProject({name:'隔离项目',instructions:'OTHER'}),c=store.createTask('独立','live',{projectId:other.id});assert.doesNotMatch(JSON.stringify(store.context(c,'codex')),/成果放 outputs|只有甲知道/);
});
test('project rule edits reach the next native turn as a delta without replaying sibling history',t=>{
 const store=fixture(t),project=store.createProject({name:'分析',instructions:'初始规则'}),task=store.createTask('任务','live',{projectId:project.id});
 const session={threadId:'thread-1',reason:'new'};
 const first=prepareCodexInput({task,prompt:'开始',session,memories:store.scopedMemories(task)});commitCodexInput(task,first);
 store.updateProject(project.id,{instructions:'新规则，请用中文'});
 const delta=prepareCodexInput({task,prompt:'继续',session:{...session,reason:'resumed'},memories:store.scopedMemories(task)});
 assert.equal(delta.mode,'delta');assert.match(delta.text,/新规则，请用中文/);assert.equal(delta.threadId,'thread-1');
});
test('adopting an old chat never moves files; archive is reversible and rejects new chats',t=>{
 const store=fixture(t),old=store.createTask('旧聊天','live'),workspace=old.workspace;fs.writeFileSync(path.join(workspace,'keep.txt'),'original');
 const project=store.createProject({name:'继续旧工作',fromTaskId:old.id});assert.equal(old.workspace,workspace);assert.equal(project.workspace,workspace);assert.equal(fs.readFileSync(path.join(workspace,'keep.txt'),'utf8'),'original');
 store.updateProject(project.id,{name:'重命名',archived:true});assert.throws(()=>store.createTask('新','live',{projectId:project.id}),/归档/);
 assert.throws(()=>store.updateProject(project.id,{workspace:os.tmpdir()}),/重定向/);
 store.updateProject(project.id,{archived:false});const fresh=store.createTask('新聊天','live',{projectId:project.id});assert.equal(fresh.workspace,workspace);assert.equal(store.task(old.id).events[0].text,'旧聊天');
 const restored=new Store(store.root,{empty:true});assert.equal(restored.project(project.id).name,'重命名');assert.equal(restored.task(fresh.id).projectId,project.id);
});
test('legacy migration backs up original state and groups native cwd without copying project contents',t=>{
 const store=fixture(t),old=store.createTask('旧记录','live'),native=store.createTask('本机会话','live'),external=path.join(store.root,'external');fs.mkdirSync(external);fs.writeFileSync(path.join(external,'secret.txt'),'not copied');
 native.storageWorkspace=native.workspace;native.workspace=external;native.nativeSession={threadId:'original-native-id',accountId:'local',source:'local'};
 delete store.state.projects;delete store.state.selectedProjectId;store.save();const before=fs.readFileSync(store.file);
 const migrated=new Store(store.root,{empty:true});assert.equal(migrated.task(old.id).projectId,undefined);assert.equal(migrated.task(native.id).nativeSession.threadId,'original-native-id');assert.equal(migrated.state.projects.length,1);assert.equal(migrated.state.projects[0].workspace,external);assert.deepEqual(fs.readFileSync(store.file+'.before-projects.json'),before);
 const task=migrated.task(native.id),sibling=migrated.createTask('同项目聊天','live',{projectId:task.projectId});migrated.event(task,'codex',`[成果](${pathToFileURL(path.join(external,'secret.txt')).href})`);
 assert.deepEqual(deliveryFiles(sibling,[task]),[{name:'secret.txt',size:10}]);assert.deepEqual(migrated.files(sibling),[]);
});

test('existing project-native threads are selected rather than imported as duplicate chats',t=>{
 const store=fixture(t),project=store.createProject({name:'原生续接'});
 const codex=store.createTask('Codex 聊天','live',{projectId:project.id});codex.threads['codex:local']='already-managed';codex.accountId='local';
 const agy=store.createTask('Antigravity 聊天','live',{projectId:project.id});agy.threads.antigravity='already-agy';agy.accountId='agy-local';
 assert.equal(attachLocalSession(store,{id:'already-managed',cwd:project.workspace},{id:'local'}).id,codex.id);
 assert.equal(attachAntigravitySession(store,{id:'already-agy',cwd:project.workspace},{id:'agy-local'}).id,agy.id);
 assert.equal(store.state.tasks.length,2);assert.equal(store.state.selectedProjectId,project.id);
});
