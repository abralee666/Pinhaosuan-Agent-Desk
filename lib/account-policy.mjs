import {resolveSelection} from './models.mjs';
export const accountPriority=a=>Number.isInteger(a?.priority)?a.priority:999;
export const rankedAccounts=accounts=>accounts.map((a,i)=>({a,i})).sort((x,y)=>accountPriority(x.a)-accountPriority(y.a)||x.i-y.i).map(x=>x.a);
export function accountSettings(input={}){
  const priority=Number(input.priority??999);
  if(!Number.isInteger(priority)||priority<1||priority>999)throw Error('优先级应为 1 至 999，数字越小越优先');
  const model=String(input.model||'').trim(),effort=String(input.effort||'').trim();
  if(model.length>160||effort&&!['none','minimal','low','medium','high','xhigh','max','ultra'].includes(effort))throw Error('无效的模型设置');
  if(!model&&effort)throw Error('使用官方默认模型时，请同时使用默认思考强度');
  const serviceTier=input.serviceTier||'default';if(!['default','fast'].includes(serviceTier))throw Error('无效的速度设置');
  return {priority,modelPreferences:{model,effort,serviceTier}};
}
export function resolveAccountSelection(models,profile){
  const configured=profile?.modelPreferences||{};
  try{return {...resolveSelection(models,configured),accountId:profile?.id};}
  catch{return {...resolveSelection(models,{}),accountId:profile?.id,accountFallback:true,originalModel:configured.model||null};}
}

export function migratePriorities(group){
  if(group.priorityOrderVersion===2)return;
  const values=[...new Set(group.accounts.filter(a=>Number.isInteger(a.priority)).map(a=>a.priority))].sort((a,b)=>b-a);
  for(const a of group.accounts)if(Number.isInteger(a.priority))a.priority=values.indexOf(a.priority)+1;
  group.priorityOrderVersion=2;
}
