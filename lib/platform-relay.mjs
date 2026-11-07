export const defaultRelay=()=>({enabled:false,order:['codex','antigravity'],onDisconnect:false,allowUnknownQuota:false,models:{}});
export function quotaFailure(text=''){
  if(/workspace.{0,30}out of credits|(?:owner|member)_credits_depleted|insufficient[_ ]credits|credits?.{0,12}(?:depleted|exhausted)|工作区.{0,10}(?:点数|余额).{0,8}(?:不足|耗尽)/i.test(text))return 'credits';
  if(/usage[_ ]?limit[_ ]?(?:exceeded|reached)|(?:hit|reached|exceeded).{0,30}(?:usage|rate).{0,5}limit|quota[_ ]?(?:exhausted|exceeded)|rate[_ ]limit[_ ]exceeded|额度.{0,8}(?:耗尽|用完)|达到.{0,8}限额/i.test(text))return 'quota';
  return null;
}
export function relayTrigger(status,text,{onDisconnect=false}={}){
  if(!['failed','interrupted'].includes(status))return null;
  const quota=quotaFailure(text);if(quota)return quota;
  if(onDisconnect&&/后台(?:连接)?(?:中断|已退出)|connection (?:closed|lost|reset)|process exited|\bEOF\b|ECONNRESET|ETIMEDOUT|fetch failed/i.test(text))return 'disconnect';
  return null;
}
export function relayEligibility(profile,allowUnknown=false,now=Date.now()){
  if(!profile||!['local-session','isolated-session'].includes(profile.source)||profile.session!=='signed_in'||!profile.enabled)return '没有已验证的本机登录账号';
  if(profile.ordinaryUsageAllowed===false)return '官方接口确认当前账号不可执行';
  if(profile.executionBlockedUntil>now)return '目标平台上次执行失败，正在冷却，稍后可重试';
  const windows=profile.quota?.monthly?[profile.quota.monthly,...[profile.quota.fiveHour,profile.quota.weekly].filter(Boolean)]:[profile.quota?.fiveHour,profile.quota?.weekly];
  const checked=Date.parse(profile.checkedAt);
  const fresh=Number.isFinite(checked)&&now-checked<24*3600000&&checked<=now;
  if(fresh&&windows.some(w=>w&&w.remaining<=0))return '额度已耗尽';
  if(!allowUnknown&&(!fresh||windows.some(w=>!w||!Number.isFinite(w.remaining))))return '额度未知，已跳过';
  return null;
}
export function validateRelaySettings(value){
  const order=value.order;
  if(!Array.isArray(order)||order.length!==2||new Set(order).size!==2||order.some(p=>!['codex','antigravity'].includes(p)))throw new Error('接力顺序必须包含 Codex 和 Antigravity，且不能重复');
  const models={};
  for(const id of order){const m=value.models?.[id]||{};if(typeof m.model!=='undefined'&&typeof m.model!=='string')throw new Error('模型设置无效');if(typeof m.effort!=='undefined'&&typeof m.effort!=='string')throw new Error('推理设置无效');models[id]={model:(m.model||'').slice(0,120),effort:(m.effort||'').slice(0,20)};}
  return {enabled:!!value.enabled,order:[...order],onDisconnect:!!value.onDisconnect,allowUnknownQuota:!!value.allowUnknownQuota,models};
}
export async function relayTask(store,task,settings,{reason='manual',retryCurrent=false,probe,launch,cancelled=()=>false,publish=()=>{}}){
  if(cancelled())return false;
  const from=task.agent;
  const checkpoint=store.checkpoint(task,from);
  task.relayAttempted||=[];
  if(!retryCurrent&&!task.relayAttempted.includes(from))task.relayAttempted.push(from);
  task.relayState={phase:'checking',from,reason,skipped:[],at:new Date().toISOString()};task.status='handoff';publish();
  for(const target of settings.order){
    if(cancelled())return false;
    if(task.relayAttempted.includes(target))continue;
    let result;
    try{result=await probe(target,settings.models?.[target]||{});}catch(error){result={error:error.message};}
    if(cancelled())return false;
    const error=result.error||relayEligibility(result.profile,settings.allowUnknownQuota);
    if(error){task.relayState.skipped.push({provider:target,reason:error});publish();continue;}
    const pack=store.context(task,target);
    store.writeArtifact(task,'context-latest.json',JSON.stringify(pack,null,2));
    task.relayAttempted.push(target);
    const handoff={from,to:target,checkpointId:checkpoint.id,reason,contextHash:pack.hash,accountId:result.profile.id,at:new Date().toISOString()};
    task.handoffs.push(handoff);task.agent=target;task.accountId=result.profile.id;
    task.relayState={...task.relayState,phase:'launching',to:target,contextHash:pack.hash};
    store.event(task,'system',`正在尝试从 ${from} 交接至 ${target}；交接资料已准备，等待目标平台实际执行确认（${pack.hash.slice(0,10)}）。`,'handoff');store.save();publish();
    try{await launch(target,result.settings,pack);}catch(error){task.status='waiting_agent';task.relayState.phase='failed';task.relayState.error=error.message;store.event(task,'system','接手平台启动失败：'+error.message,'waiting_agent');store.save();publish();return false;}
    return true;
  }
  if(cancelled())return false;
  task.status='waiting_agent';task.relayState.phase='waiting';
  store.event(task,'system','无可接手的可用平台，任务已暂停并保存进度；连接可用平台后可点击“重试交接”。','waiting_agent');store.save();publish();return false;
}
