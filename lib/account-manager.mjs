import {randomUUID} from 'node:crypto';
export const providerNames={codex:'Codex',antigravity:'Antigravity'};
export const today=(now=Date.now())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
export function accountProfile(provider,name,identifier){return {id:randomUUID(),provider,name,identifier,enabled:true,session:'signed_out',checkedAt:null,quota:null,credentialStatus:'session_required'};}
export function initialManager(){return {execution:'local-fixture',providers:Object.fromEntries(Object.keys(providerNames).map(provider=>[provider,{accounts:[accountProfile(provider,'工作账号','work@example.test'),accountProfile(provider,'备用账号','backup@example.test')],activeAccountId:null,autoSwitch:false,audit:[],operation:null}]))};}
export function quotaKnown(a,now=Date.now()){const checked=Date.parse(a.checkedAt);return !!a.quota&&Number.isFinite(checked)&&today(checked)===today(now);}
export function canUse(a,now=Date.now()){return a.enabled&&quotaKnown(a,now)&&a.quota.fiveHour.remaining>0&&a.quota.weekly.remaining>0;}
export function record(p,action,accountId,details={}){p.audit.push({id:randomUUID(),action,accountId,at:new Date().toISOString(),...details});if(p.audit.length>200)p.audit.shift();}
export function removeAccount(p,id){
  const index=p.accounts.findIndex(a=>a.id===id);if(index<0)throw Error('账号不存在或已移除');
  const profile=p.accounts[index];
  // Retain the connection for recovery; task history and official login files stay intact.
  p.removedAccounts||=[];p.removedAccounts.push({...profile,enabled:false,removedAt:new Date().toISOString()});
  if(profile.source==='local-session'){
    p.hiddenLocalIdentities||=[];
    const key=profile.localIdentityKey||profile.email?.toLowerCase()||'current-local-session';
    if(!p.hiddenLocalIdentities.includes(key))p.hiddenLocalIdentities.push(key);
  }
  p.accounts.splice(index,1);if(p.activeAccountId===id)p.activeAccountId=null;
  record(p,'account_removed',id);return profile;
}
export async function activate(p,id,{query=true,publish=()=>{},delay=80}={}){
  const a=p.accounts.find(a=>a.id===id);if(!a||!a.enabled)throw new Error('账号不可用');
  if(['local-session','isolated-session'].includes(a.source))throw new Error('官方登录账号必须通过官方接口刷新');
  const pause=()=>new Promise(r=>setTimeout(r,delay));
  if(p.activeAccountId!==id||a.session!=='signed_in'){
    const old=p.accounts.find(a=>a.id===p.activeAccountId);
    if(old){p.operation={phase:'signing_out',accountId:old.id};record(p,'logout_started',old.id);publish();await pause();old.session='signed_out';record(p,'logout_completed',old.id);p.activeAccountId=null;}
    p.operation={phase:'signing_in',accountId:id};a.session='signing_in';record(p,'login_started',id);publish();await pause();
    a.session='signed_in';a.credentialStatus='session_ready';p.activeAccountId=id;record(p,'login_completed',id);
  }
  if(query){
    p.operation={phase:'querying_quota',accountId:id};record(p,'quota_query_started',id);publish();await pause();
    // This adapter is an isolated fixture. It never calls upstream login or quota APIs.
    if(!a.quota)a.quota={fiveHour:{remaining:2,capacity:2,resetsAt:Date.now()+5*3600000},weekly:{remaining:20,capacity:20,resetsAt:Date.now()+7*86400000}};
    for(const [key,duration] of [['fiveHour',5*3600000],['weekly',7*86400000]])if(a.quota[key].resetsAt<=Date.now()){a.quota[key].remaining=a.quota[key].capacity;a.quota[key].resetsAt=Date.now()+duration;}
    a.checkedAt=new Date().toISOString();record(p,'quota_query_completed',id);
  }
  p.operation=null;publish();return a;
}
export async function selectForTask(p,currentId,{publish=()=>{},delay=80}={}){
  const current=p.accounts.find(a=>a.id===(p.activeAccountId||currentId));
  if(['local-session','isolated-session'].includes(current?.source))return null;
  if(current&&current.enabled){
    if(!quotaKnown(current))await activate(p,current.id,{publish,delay});
    if(canUse(current))return await activate(p,current.id,{query:false,publish,delay});
  }
  if(current&&!p.autoSwitch)return null;
  for(const a of p.accounts){
    if(!a.enabled||a.id===current?.id||['local-session','isolated-session'].includes(a.source))continue;
    if(!quotaKnown(a))await activate(p,a.id,{publish,delay});
    if(canUse(a))return await activate(p,a.id,{query:false,publish,delay});
  }
  return null;
}
