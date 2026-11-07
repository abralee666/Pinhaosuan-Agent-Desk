import fs from 'node:fs';
import path from 'node:path';
import {executionSettings} from './execution.mjs';

const sources=['cli','vscode','appServer','unknown'];
const validId=id=>typeof id==='string'&&/^[a-z0-9_-]{1,128}$/i.test(id);
export class LocalSessions {
  constructor(client,{managedRoot}={}){this.client=client;this.managedRoot=managedRoot&&path.resolve(managedRoot);this.offered=new Set();}
  async list({cursor=null,search=''}={}){
    if(cursor!==null&&(typeof cursor!=='string'||cursor.length>8192))throw Error('无效的分页参数');
    if(typeof search!=='string'||search.length>120)throw Error('搜索词最多120字');
    await this.client.start();
    const result=await this.client.request('thread/list',{limit:40,cursor,sortKey:'updated_at',sourceKinds:sources,searchTerm:search||null,archived:false});
    const data=(result.data||[]).filter(t=>{
      if(!validId(t.id)||!t.cwd||t.ephemeral)return false;
      try{if(!fs.statSync(t.cwd).isDirectory()||(t.path&&!fs.existsSync(t.path)))return false;}catch{return false;}
      const rel=this.managedRoot&&path.relative(this.managedRoot,path.resolve(t.cwd));
      return !this.managedRoot||path.isAbsolute(rel)||rel==='..'||rel.startsWith('..'+path.sep);
    }).map(t=>{
      this.offered.add(t.id);
      return {id:t.id,title:t.name||t.preview||'未命名会话',cwd:t.cwd,updatedAt:t.updatedAt,model:t.model,effort:t.reasoningEffort,status:t.status?.type||'unknown'};
    });
    return {data,nextCursor:result.nextCursor||null};
  }
  async read(threadId){
    if(!validId(threadId)||!this.offered.has(threadId))throw Error('请先刷新本地会话列表，再选择会话');
    const {thread}=await this.client.request('thread/read',{threadId,includeTurns:true});
    if(thread.id!==threadId||!path.isAbsolute(thread.cwd||'')||!fs.statSync(thread.cwd).isDirectory())throw Error('原项目目录不可用，未接入会话');
    if(thread.status?.type==='active')throw Error('该会话正在执行，请等待原回合结束');
    // Paginated native threads may omit turns. Use the official page API, never raw credentials/session files.
    let turns=thread.turns||[],nextCursor=null;
    if(!turns.length||turns.some(t=>t.itemsView==='notLoaded')){
      const page=await this.client.request('thread/turns/list',{threadId,limit:40,sortDirection:'desc',itemsView:'full'});
      turns=[...(page.data||[])].reverse();nextCursor=page.nextCursor||null;
    }
    return {...thread,turns,olderHistoryAvailable:!!nextCursor};
  }
}
export function attachLocalSession(store,thread,profile,input={}){
  const existing=store.state.tasks.find(t=>(t.nativeSession?.provider!=='antigravity'&&t.nativeSession?.threadId===thread.id&&t.nativeSession.accountId===profile.id)||t.threads?.[`codex:${profile.id}`]===thread.id);
  if(existing){store.ensureProjectForTask(existing);store.state.selectedTaskId=existing.id;store.save();return existing;}
  const task=store.createTask(thread.name||thread.preview||'本地 Codex 会话','live');
  task.storageWorkspace=task.workspace;task.workspace=fs.realpathSync(thread.cwd);
  Object.assign(task,executionSettings(input));
  task.accountId=profile.id;task.nativeSession={threadId:thread.id,accountId:profile.id,source:'local',olderHistoryAvailable:thread.olderHistoryAvailable===true};
  task.events=[];
  for(const turn of (thread.turns||[]).slice(-80)){
    for(const item of turn.items||[]){
      const actor=item.type==='userMessage'?'user':item.type==='agentMessage'?'codex':null;
      if(!actor)continue;
      const text=actor==='user'?(item.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('\n'):item.text;
      if(typeof text==='string'&&text)store.event(task,actor,text.slice(0,30000),'message',{nativeItemId:item.id,at:new Date((turn.startedAt||thread.updatedAt||Date.now()/1000)*1000).toISOString()});
    }
    if(turn.status==='completed')task.completed.push('已载入原生回合');
  }
  store.event(task,'system','已接入本地 Codex 会话和原项目目录；尚未执行新指令。请避免在桌面与拼好算同时向该会话发送消息。','context');
  task.nativeSession.importEventCursor=task.events.length;
  task.status='idle';store.ensureProjectForTask(task);store.save();return task;
}
