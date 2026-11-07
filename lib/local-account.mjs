import {accountProfile,providerNames,record} from './account-manager.mjs';
export function usageAvailability(raw,now=new Date().toISOString()){
  const bucket=raw?.rateLimitsByLimitId?.codex||raw?.rateLimits||raw||{};
  return {ordinaryUsageAllowed:typeof raw?.ordinaryUsageAllowed==='boolean'?raw.ordinaryUsageAllowed:null,usageCheckedAt:now,credits:bucket.credits?{hasCredits:bucket.credits.hasCredits===true,unlimited:bucket.credits.unlimited===true}:null,rateLimitReachedType:bucket.rateLimitReachedType||null,spendControlReached:bucket.spendControlReached??null};
}
export function mergeQuota(newQ, oldQ){
  if(!newQ)return oldQ||null;
  if(!oldQ)return newQ;
  return {
    fiveHour:newQ.fiveHour?{...oldQ.fiveHour,...newQ.fiveHour,resetsAt:newQ.fiveHour.resetsAt??oldQ.fiveHour?.resetsAt??null}:oldQ.fiveHour||null,
    weekly:newQ.weekly?{...oldQ.weekly,...newQ.weekly,resetsAt:newQ.weekly.resetsAt??oldQ.weekly?.resetsAt??null}:oldQ.weekly||null,
    monthly:newQ.monthly?{...oldQ.monthly,...newQ.monthly,resetsAt:newQ.monthly.resetsAt??oldQ.monthly?.resetsAt??null}:oldQ.monthly||null
  };
}
export function normalizeLocalQuota(raw){
  const byId=raw?.rateLimitsByLimitId?Object.values(raw.rateLimitsByLimitId)[0]:null;
  const limits=byId||raw?.rateLimits||raw;
  const quota={fiveHour:null,weekly:null,monthly:null};
  for(const window of [limits?.primary,limits?.secondary]){
    const key=window?.windowDurationMins===300?'fiveHour':window?.windowDurationMins===10080?'weekly':window?.windowDurationMins===43200?'monthly':null;
    if(key&&Number.isFinite(window.usedPercent))quota[key]={remaining:Math.max(0,Math.min(100,100-window.usedPercent)),capacity:100,resetsAt:Number.isFinite(window.resetsAt)?window.resetsAt*1000:null};
  }
  if(!quota.fiveHour&&!quota.weekly&&!quota.monthly){
    if(raw?.ordinaryUsageAllowed===false||raw?.rateLimitReachedType||limits?.rateLimitReachedType){
      const resetTime=Number.isFinite(limits?.primary?.resetsAt)?limits.primary.resetsAt*1000:Number.isFinite(limits?.resetsAt)?limits.resetsAt*1000:null;
      quota.fiveHour={remaining:0,capacity:100,resetsAt:resetTime};
    }
  }
  return quota.fiveHour||quota.weekly||quota.monthly?quota:null;
}
export function syncLocalAccount(manager,provider,identity,quota,now=new Date().toISOString()){
  const group=manager.providers[provider];
  if(!identity){for(const a of group.accounts.filter(a=>a.source==='local-session'))a.session='signed_out';if(group.accounts.find(a=>a.id===group.activeAccountId)?.source==='local-session')group.activeAccountId=null;return null;}
  // Select public identity fields explicitly; never copy credentials from upstream objects.
  const email=typeof identity.email==='string'?identity.email.trim():'';
  const displayName=[identity.name,identity.displayName,identity.username].find(s=>typeof s==='string'&&s.trim())?.trim()||null;
  const upstreamId=typeof identity.id==='string'?identity.id:null;
  const key=(email||upstreamId||'current-local-session').toLowerCase();
  if(group.hiddenLocalIdentities?.includes(key))return null;
  let profile=group.accounts.find(a=>a.source!=='isolated-session'&&(a.localIdentityKey===key||(email&&a.identifier?.toLowerCase()===email.toLowerCase())));
  if(!profile&&email)profile=group.accounts.find(a=>a.source==='local-session'&&a.localIdentityKey==='current-local-session');
  if(!profile){profile=accountProfile(provider,displayName||`${providerNames[provider]} 账号`,email||upstreamId||'身份信息未提供');group.accounts.push(profile);record(group,'local_account_discovered',profile.id);}
  for(const a of group.accounts.filter(a=>a.source==='local-session'&&a.id!==profile.id))a.session='signed_out';
  Object.assign(profile,{source:'local-session',localIdentityKey:key,email:email||null,displayName,name:displayName||`${providerNames[provider]} 账号`,identifier:email||upstreamId||'身份信息未提供',plan:identity.planType||null,session:'signed_in',credentialStatus:'session_ready',lastVerifiedAt:now,quota,checkedAt:quota?now:null});
  group.activeAccountId=profile.id;return profile;
}
