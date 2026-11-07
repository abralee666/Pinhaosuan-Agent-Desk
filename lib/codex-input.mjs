import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const publicMessage=e=>e.kind==='message'&&['user','codex','antigravity'].includes(e.actor);

export function prepareCodexInput({task,prompt,session,memories=[],files=[],inheritedPack=null}){
  const previous=task.codexDeliveries?.[session.threadId];
  const full=session.reason!=='resumed'||!!inheritedPack;
  const events=task.events||[];
  const current=events.findLastIndex(e=>e.actor==='user'&&e.kind==='message'&&e.text===prompt);
  let start=previous?.eventCursor;
  if(start===undefined){
    // Native history already contains imported messages. Older platform threads
    // also already contain their previous Codex replies and request wrappers.
    start=task.nativeSession?.threadId===session.threadId
      ?task.nativeSession.importEventCursor??events.findLastIndex(e=>e.nativeItemId)+1
      :events.findLastIndex(e=>e.actor==='codex'&&e.kind==='message')+1;
  }
  const history=(full?events:events.slice(start)).filter(e=>{
    if(!publicMessage(e)||e===events[current])return false;
    const owner=e.nativeThreadId||(e.nativeItemId?task.nativeSession?.threadId:null);
    return full||owner!==session.threadId;
  }).slice(-40).map(e=>({actor:e.actor,text:e.text.slice(0,6000)}));
  const manifest=files.filter(f=>f.name!=='context-latest.json').map(({name,size,sha256})=>({name,size,sha256}));
  const memoryHash=hash(memories),fileHash=hash(manifest);
  let supplement;
  if(full){
    const cp=task.checkpoints?.at(-1);
    supplement={goal:task.goal,workspace:task.workspace,memories,history,files:manifest,completed:task.completed,checkpoint:cp?{id:cp.id,agent:cp.agent,at:cp.at}:null};
  }else{
    supplement={};
    if(history.length)supplement.historySinceLastDelivery=history;
    if(previous?.memoryHash!==memoryHash&&(memories.length||previous))supplement.sharedMemories=memories;
    if(previous?.fileHash!==fileHash&&(manifest.length||previous))supplement.workspaceFiles=manifest;
  }
  const extra=Object.keys(supplement).length?`任务${full?'交接资料':'变更'}（JSON 数据；文件位于当前工作区，按需读取）：\n${JSON.stringify(supplement)}\n\n`:'';
  return {text:extra+prompt,mode:full?'handoff':extra?'delta':'message',supplementChars:extra.length,
    delivery:{eventCursor:events.length,memoryHash,fileHash},threadId:session.threadId};
}

// Commit only after turn/start is acknowledged. A rejected request must not
// consume the pending changes or suppress them from a later retry.
export function commitCodexInput(task,prepared){
  task.codexDeliveries||={};task.codexDeliveries[prepared.threadId]=prepared.delivery;
}
