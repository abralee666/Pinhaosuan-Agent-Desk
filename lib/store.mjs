import {initializeProjects,createProject,updateProject,projectById,syncProject,ensureProjectForTask,scopedMemories} from './projects.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import {demoAccount} from './account-pool.mjs';
import {initialManager} from './account-manager.mjs';

export const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export class Store {
  constructor(root, { empty = false } = {}) {
    this.root = root;
    fs.mkdirSync(root, { recursive: true });
    this.file = path.join(root, 'state.json');
    const exists = fs.existsSync(this.file);
    this.state = exists ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : {
      version: 1, memories: [
        { id: randomUUID(), text: '用中文沟通；任务交接时保留已经完成的工作。', createdAt: new Date().toISOString() },
        { id: randomUUID(), text: '报告减少使用“不是……而是……”的表述。', createdAt: new Date().toISOString() }
      ], tasks: [], selectedTaskId: null
    };
    initializeProjects(this);
    this.state.demoAccounts ||= [demoAccount('Plus 账号 A'),demoAccount('Plus 账号 B'),demoAccount('Plus 账号 C')];
    this.state.accountManager ||= initialManager();
    if (empty && !exists) {
      this.state.memories = [];
      this.state.demoAccounts = [];
      for (const p of Object.values(this.state.accountManager.providers)) p.accounts = [];
    }
    for(const p of Object.values(this.state.accountManager.providers)){
      if(p.operation){p.operation=null;for(const a of p.accounts)if(a.session==='signing_in')a.session='signed_out';}
    }
    for (const task of this.state.tasks) {
      if (['running', 'handoff'].includes(task.status)) {
        task.status = 'interrupted';
        task.recovery={reason:'restart',at:new Date().toISOString()};
        this.checkpoint(task,task.agent);
        this.event(task, 'system', '后台服务重新启动。已保存记录；可从检查点继续。', 'interrupted');
      }
    }
    this.save();
  }
  save() {
    const temp = this.file + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(this.state, null, 2));
    for(let attempt=0;;attempt++){
      try{fs.renameSync(temp,this.file);break;}
      catch(error){
        if(process.platform!=='win32'||!['EPERM','EACCES','EBUSY'].includes(error.code)||attempt>=20)throw error;
        // Windows readers and antivirus may briefly hold the destination open.
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,25);
      }
    }
  }
  task(id) {
    const task = this.state.tasks.find(t => t.id === id);
    if (!task) throw new Error('任务不存在');
    return syncProject(this,task);
  }
  project(id){return projectById(this,id);}
  createProject(input){return createProject(this,input);}
  updateProject(id,input){return updateProject(this,id,input);}
  ensureProjectForTask(task){return ensureProjectForTask(this,task);}
  scopedMemories(task){return scopedMemories(this,task);}
  createTask(goal, mode = 'demo', {projectId=null}={}) {
    const project=projectId?this.project(projectId):null;
    if(project?.archived)throw Error('项目已归档，请先恢复项目');
    if(project&&!fs.statSync(project.workspace).isDirectory())throw Error('项目目录不可用');
    const id = randomUUID();
    const workspace = path.join(this.root, 'workspaces', id);
    fs.mkdirSync(workspace, { recursive: true });
    const task = { id, goal, mode, workspace, status: 'idle', agent: 'codex', completed: [], events: [],
      files: [], handoffs: [], checkpoints: [], contexts: [], threads: {}, createdAt: new Date().toISOString() };
    if(project){task.storageWorkspace=workspace;task.workspace=project.workspace;task.projectId=project.id;syncProject(this,task);}
    this.state.selectedProjectId=projectId;
    this.event(task, 'user', goal, 'message');
    this.state.tasks.unshift(task);
    this.state.selectedTaskId = id;
    this.save();
    return task;
  }
  event(task, actor, text, kind = 'message', details = {}) {
    const event = { id: randomUUID(), actor, text, kind, at: new Date().toISOString(), ...details };
    task.events.push(event);
    return event;
  }
  addMemory(text) {
    if (!text?.trim() || text.length > 3000) throw new Error('记忆需为 1–3000 个字符');
    if (this.state.memories.length >= 60) throw new Error('原型最多保存 60 条记忆');
    if (this.state.memories.reduce((n, m) => n + m.text.length, 0) + text.length > 20000) throw new Error('原型记忆总量最多 20000 个字符');
    const memory = { id: randomUUID(), text: text.trim(), createdAt: new Date().toISOString() };
    this.state.memories.push(memory);
    this.save();
    return memory;
  }
  context(task, target, routing={}) {
    syncProject(this,task);
    const files = this.files(task).filter(f => f.name !== 'context-latest.json');
    const pack = { schema: 1, taskId: task.id, target, goal: task.goal, executionMode: task.executionMode || 'read-only', networkAccess:['workspace','full-access'].includes(task.executionMode) && task.networkAccess === true,
      memories: this.scopedMemories(task),
      ...(task.projectContext?{project:task.projectContext}:{}),
      completed: [...task.completed], nextStep: task.completed.length,
      files: files.map(f => ({ name: f.name, sha256: f.sha256, content: f.content })),
      history: task.events.slice(-40).map(e => ({ actor: e.actor, kind: e.kind, text: e.text.slice(0, 6000) })),
      checkpoint: task.checkpoints.at(-1) || null, createdAt: new Date().toISOString(), ...routing };
    pack.hash = digest(pack);
    task.contexts.push(pack);
    this.save();
    return pack;
  }
  files(task) {
    // External projects are accessed by the native agent on demand. Do not scan
    // and copy an existing repository into state, phone views, or handoff packs.
    if(task.nativeSession||task.projectId)return [];
    const files=[];let bytes=0;
    const visit=(dir,depth=0)=>{
      if(depth>8||files.length>=200||bytes>=2000000)return;
      let entries;
      try{entries=fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name));}catch{return;}
      for(const entry of entries){
        if(files.length>=200||bytes>=2000000)break;
        if(['.attachments','.git','node_modules','.gemini','.codex','.npm-cache','.cache','__pycache__','.venv','.next','.wrangler'].includes(entry.name)||/^\.env(?:\.|$)/.test(entry.name))continue;
        const filePath=path.join(dir,entry.name);
        let stat;
        try{stat=fs.lstatSync(filePath);}catch{continue;}
        if(stat.isSymbolicLink())continue;
        if(stat.isDirectory()){visit(filePath,depth+1);continue;}
        if(!stat.isFile()||stat.size>512000||bytes+stat.size>2000000)continue;
        let buffer;
        try{buffer=fs.readFileSync(filePath);}catch{continue;}
        if(buffer.includes(0))continue;
        const content=buffer.toString('utf8');if(!Buffer.from(content).equals(buffer))continue;
        files.push({name:path.relative(task.workspace,filePath).split(path.sep).join('/'),content,size:stat.size,sha256:digest(content)});bytes+=stat.size;
      }
    };
    try{visit(task.workspace);}catch{}
    return files;
  }
  checkpoint(task, agent) {
    const cp = { id: randomUUID(), agent, accountId:task.accountId||null, completed: [...task.completed],
      files: this.files(task).map(f => ({ name: f.name, sha256: f.sha256 })), at: new Date().toISOString() };
    task.checkpoints.push(cp);
    this.save();
    return cp;
  }
  writeArtifact(task, name, content) {
    if (!/^[a-zA-Z0-9_.-]+$/.test(name)) throw new Error('无效的文件名');
    const target = path.join(task.storageWorkspace || task.workspace, name);
    if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw new Error('不允许写入符号链接');
    fs.writeFileSync(target, content);
    if (!task.files.includes(name)) task.files.push(name);
    this.save();
  }
}
