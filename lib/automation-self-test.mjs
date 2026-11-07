import {randomBytes} from 'node:crypto';

export function createAutomationTest(store,{kind,provider,accountId,models={},now=Date.now()}){
  if(!['sentinel','relay'].includes(kind)||!['codex','antigravity'].includes(provider))throw Error('无效的自检类型或平台');
  const token='DESK-CHECK-'+randomBytes(6).toString('hex').toUpperCase();
  const task=store.createTask(`模拟验收 · ${kind==='sentinel'?'哨兵恢复':'跨平台接力'} · ${token}`,'live');
  Object.assign(task,{agent:provider,accountId,executionMode:'read-only',networkAccess:false,
    currentPrompt:`这是独立流程验收。只回复校验词 ${token}，不要调用工具，不读写项目文件。`,
    status:'failed',recovery:{reason:'quota',at:new Date(now).toISOString()},modelSettings:structuredClone(models),
    selfTest:{kind,token,phase:kind==='sentinel'?'waiting':'checking',createdAt:now,releaseAt:now+30000,source:provider}});
  store.event(task,'system','【模拟验收】模拟额度耗尽；真实账号额度未修改。仅接手模型的一次简短回复会使用额度。','self_test');
  store.checkpoint(task,provider);
  return task;
}

// Only the test task sees this temporary exhausted snapshot; account records stay untouched.
export function selfTestProfile(task,profile,now=Date.now()){
  if(task.selfTest?.kind!=='sentinel'||task.selfTest.phase!=='waiting'||now>=task.selfTest.releaseAt)return profile;
  return {...profile,ordinaryUsageAllowed:false,usageCheckedAt:new Date(now).toISOString(),
    quota:{selfTest:{remaining:0,resetsAt:task.selfTest.releaseAt}}};
}

export function finishAutomationTest(store,task,status,error=''){
  if(!task.selfTest)return;
  const check=task.selfTest;
  if(check.phase==='canceled'&&status==='completed')return;
  const replies=task.events.filter(e=>e.actor===task.agent&&e.kind==='message');
  const matched=replies.some(e=>e.text?.trim()===check.token);
  check.phase=status==='completed'&&matched?'passed':status==='interrupted'?'canceled':'failed';
  check.finishedAt=Date.now();
  check.error=check.phase==='passed'?null:status==='completed'?'回合结束，但未收到完全匹配的校验回复':error||'验收未完成';
  store.event(task,'system',check.phase==='passed'?'模拟验收通过：已收到目标模型的真实校验回复。':`模拟验收未通过：${check.error}`,'self_test');
}
