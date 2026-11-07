import { randomUUID } from 'node:crypto';

export function demoAccount(name, budget=2) {
  return {id:randomUUID(),name,provider:'codex',plan:'Plus · 模拟',enabled:true,auth:'ready',models:['demo-codex-model'],
    fiveHour:{remaining:budget,capacity:budget,resetsAt:Date.now()+5*3600000},weekly:{remaining:20,capacity:20,resetsAt:Date.now()+7*86400000}};
}
export function refreshWindows(accounts,now=Date.now()) {
  for(const account of accounts)for(const key of ['fiveHour','weekly']){
    const window=account[key];
    if(window.resetsAt<=now){window.remaining=window.capacity;window.resetsAt=now+(key==='fiveHour'?5*3600000:7*86400000);}
  }
}
export function eligible(account,model) {
  return account.enabled && account.auth==='ready' && account.models.includes(model) && account.fiveHour.remaining>0 && account.weekly.remaining>0;
}
export function chooseAccount(accounts,model,currentId=null,now=Date.now()) {
  refreshWindows(accounts,now);
  return accounts.find(a=>a.id===currentId&&eligible(a,model)) || accounts.find(a=>eligible(a,model)) || null;
}
export function consumeStep(account) {
  if(account.fiveHour.remaining<=0||account.weekly.remaining<=0)throw new Error('账号额度已耗尽');
  account.fiveHour.remaining--;account.weekly.remaining--;
}
export function nextRecovery(accounts,model) {
  const times=accounts.filter(a=>a.enabled&&a.auth==='ready'&&a.models.includes(model)).map(a=>Math.max(
    a.fiveHour.remaining>0?0:a.fiveHour.resetsAt,a.weekly.remaining>0?0:a.weekly.resetsAt));
  return times.length?Math.min(...times):null;
}
