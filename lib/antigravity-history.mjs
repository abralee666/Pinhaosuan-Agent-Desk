import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {executionSettings} from './execution.mjs';

const validId=id=>typeof id==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id);
async function database(file){
  if(fs.lstatSync(file).isSymbolicLink())throw Error('不读取链接会话库');
  let DatabaseSync;try{({DatabaseSync}=await import('node:sqlite'));}catch{throw Error('Antigravity 本机会话读取需要 Node.js 22.13 或更新版本');}
  return new DatabaseSync(file,{readOnly:true});
}
// Decode only explicit public message fields. Never recurse through metadata or reasoning.
export function protoFields(input){
  const b=Buffer.from(input);let p=0;const fields=[];
  const varint=()=>{let n=0,s=0,x;do{if(p>=b.length||s>49)throw Error('无效的会话消息');x=b[p++];n+=(x&127)*2**s;s+=7;}while(x&128);return n;};
  while(p<b.length){const tag=varint(),wire=tag%8,field=Math.floor(tag/8);if(!field)throw Error('无效的会话消息');
    if(wire===0)fields.push({field,value:varint()});
    else if(wire===2){const length=varint();if(p+length>b.length)throw Error('无效的会话消息');fields.push({field,bytes:b.subarray(p,p+length)});p+=length;}
    else if(wire===1||wire===5){p+=wire===1?8:4;if(p>b.length)throw Error('无效的会话消息');}
    else throw Error('不支持的会话消息格式');
  }return fields;
}
export function publicAntigravityMessage(row){
  if(![14,15].includes(row.step_type)||row.step_format!==0)return null;
  if(!row.step_payload||row.step_payload.length>2*1024*1024)throw Error('会话消息过大或格式不受支持');
  const outer=protoFields(row.step_payload),type=outer.find(f=>f.field===1)?.value;
  if(type!==row.step_type)return null;
  const payload=outer.find(f=>f.field===(type===14?19:20))?.bytes;if(!payload)return null;
  const fields=protoFields(payload),selected=type===14?[2,3]:[8,1];
  for(const field of selected){const bytes=fields.find(f=>f.field===field)?.bytes;if(!bytes?.length)continue;
    const text=bytes.toString('utf8');if(!Buffer.from(text).equals(bytes))throw Error('不支持的会话消息编码');
    return {id:String(row.idx),actor:type===14?'user':'antigravity',text};
  }return null;
}
export class AntigravityHistory {
  constructor({home=path.join(os.homedir(),'.gemini','antigravity-cli'),managedRoot}={}){this.home=home;this.managedRoot=managedRoot&&path.resolve(managedRoot);this.offered=new Set();}
  async list({search='',cursor=null,limit=40}={}){
    if(typeof search!=='string'||search.length>120)throw Error('搜索词最多120字');
    if(cursor!==null&&(typeof cursor!=='string'||!/^\d{1,7}$/.test(cursor)))throw Error('无效的分页参数');
    if(!Number.isInteger(limit)||limit<1||limit>40)throw Error('无效的分页大小');
    const file=path.join(this.home,'conversation_summaries.db');if(!fs.existsSync(file))return {data:[],nextCursor:null};
    const db=await database(file);let rows;try{rows=db.prepare('SELECT conversation_id,title,preview,workspace_uris,last_modified_time,status,not_fully_idle FROM conversation_summaries ORDER BY last_modified_time DESC,conversation_id DESC').all();}finally{db.close();}
    const data=[];for(const row of rows){
      if(!validId(row.conversation_id)||!fs.existsSync(path.join(this.home,'conversations',row.conversation_id+'.db')))continue;
      let cwd;try{const uris=JSON.parse(row.workspace_uris||'[]');if(uris.length!==1||typeof uris[0]!=='string')continue;cwd=fs.realpathSync(fileURLToPath(uris[0]));if(!fs.statSync(cwd).isDirectory())continue;}catch{continue;}
      const rel=this.managedRoot&&path.relative(this.managedRoot,cwd);if(this.managedRoot&&!path.isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+path.sep))continue;
      const title=row.title||row.preview||'未命名 Antigravity 会话';if(search&&!title.toLowerCase().includes(search.toLowerCase()))continue;
      const updatedAt=Date.parse(row.last_modified_time)/1000;if(!Number.isFinite(updatedAt))continue;
      data.push({id:row.conversation_id,title:title.slice(0,160),cwd,updatedAt,status:row.not_fully_idle||/RUNNING|PENDING/.test(row.status)?'active':'idle'});
    }
    const offset=Number(cursor||0),page=data.slice(offset,offset+limit);for(const row of page)this.offered.add(row.id);
    return {data:page,nextCursor:offset+limit<data.length?String(offset+limit):null};
  }
  async read(id,{requireOffered=true,requireIdle=true,before=null,limit=160}={}){
    if(!validId(id)||requireOffered&&!this.offered.has(id))throw Error('请先刷新本地会话列表，再选择会话');
    const summaries=await this.listAll();const info=summaries.find(row=>row.id===id);if(!info)throw Error('原会话或项目目录不可用');
    if(requireIdle&&info.status==='active')throw Error('该会话正在执行，请等待原回合结束');
    if(before!==null&&(!Number.isSafeInteger(before)||before<0))throw Error('无效的分页参数');
    if(!Number.isInteger(limit)||limit<1||limit>160)throw Error('无效的分页大小');
    const db=await database(path.join(this.home,'conversations',id+'.db'));let rows;
    try{rows=db.prepare('SELECT idx,step_type,step_format,step_payload FROM steps WHERE step_type IN (14,15) AND idx < ? ORDER BY idx DESC LIMIT ?').all(before??Number.MAX_SAFE_INTEGER,limit+1);}finally{db.close();}
    const more=rows.length>limit;rows=rows.slice(0,limit);const messages=rows.map(publicAntigravityMessage).filter(Boolean).reverse().map(m=>({...m,at:info.updatedAt}));
    return {...info,messages,olderHistoryAvailable:more,nextCursor:more?String(rows.at(-1).idx):null};
  }
  async listAll(){let rows=[],cursor=null;do{const page=await this.list({cursor});rows.push(...page.data);cursor=page.nextCursor;}while(cursor);return rows;}
}
export function attachAntigravitySession(store,thread,profile,input={}){
  const existing=store.state.tasks.find(t=>(t.nativeSession?.provider==='antigravity'&&t.nativeSession.threadId===thread.id&&t.nativeSession.accountId===profile.id)||(t.threads?.antigravity===thread.id&&t.accountId===profile.id));
  if(existing){store.ensureProjectForTask(existing);store.state.selectedTaskId=existing.id;store.save();return existing;}
  const task=store.createTask(thread.title,'live');task.storageWorkspace=task.workspace;task.workspace=fs.realpathSync(thread.cwd);
  Object.assign(task,executionSettings(input));task.agent='antigravity';task.accountId=profile.id;
  task.nativeSession={provider:'antigravity',threadId:thread.id,accountId:profile.id,source:'local',olderHistoryAvailable:thread.olderHistoryAvailable};
  task.threads.antigravity=thread.id;task.events=[];
  for(const m of thread.messages)store.event(task,m.actor,m.text.slice(0,30000),'message',{nativeItemId:m.id,at:new Date(m.at*1000).toISOString()});
  store.event(task,'system','已接入本机 Antigravity CLI 会话和原项目目录；发送新消息才会继续。请避免两端同时发送。','context');
  task.status='idle';store.ensureProjectForTask(task);store.save();return task;
}
