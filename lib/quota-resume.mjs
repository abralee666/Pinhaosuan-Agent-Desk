import {quotaFailure} from './platform-relay.mjs';
// Only official, exhausted quota windows can supply an automatic recovery time.
export function pendingQuotaOrigin(task,providers){
  if(task.mode!=='live'||!['failed','interrupted','waiting_agent','waiting_account','waiting_quota'].includes(task.status)||task.recovery?.reason==='stopped'||task.quotaWait)return null;
  const completed=task.events.findLast(e=>e.kind==='completed')?.at||'';
  const failure=task.events.findLast(e=>e.kind==='failed'&&e.at>completed&&quotaFailure(e.text));
  if(!failure)return null;
  const run=task.modelRuns?.findLast(r=>r.at<=failure.at),provider=run?.agent||task.agent;
  const key=Object.entries(task.threads||{}).find(([,v])=>v===run?.threadId)?.[0];
  const accountId=run?.accountId||(key?.startsWith('codex:')?key.slice(6):null)||providers[provider]?.activeAccountId;
  return {provider,accountId,kind:quotaFailure(failure.text)};
}
export function quotaReset(quota,now=Date.now()) {
  if(!quota)return null;
  const exhausted=Object.values(quota).filter(w=>w&&typeof w==='object'&&Number.isFinite(w.remaining)&&w.remaining<=0);
  if(!exhausted.length||exhausted.some(w=>!Number.isFinite(w.resetsAt)||w.resetsAt<1e12))return null;
  return Math.max(now+1000,...exhausted.map(w=>w.resetsAt));
}
export function quotaReady(profile,now=Date.now(),kind='quota') {
  if(profile?.session!=='signed_in'||profile.enabled===false)return false;
  if(Object.hasOwn(profile,'ordinaryUsageAllowed')){
    const checked=Date.parse(profile.usageCheckedAt);
    return Number.isFinite(checked)&&checked<=now&&now-checked<=60000&&profile.ordinaryUsageAllowed===true&&profile.spendControlReached!==true;
  }
  if(kind==='credits')return false;
  const checked=Date.parse(profile.checkedAt);
  if(!Number.isFinite(checked)||checked>now||now-checked>60000)return false;
  const windows=Object.values(profile.quota||{}).filter(w=>w&&typeof w==='object');
  return windows.length>0&&windows.every(w=>Number.isFinite(w.remaining)&&w.remaining>0);
}
const pending=wait=>wait&&['scheduled','needs_time','needs_auth','resuming'].includes(wait.status);
export class QuotaResume {
  constructor({tasks,enabled,busy,profile,refresh,resume,publish,onError,now=Date.now}){Object.assign(this,{tasks,enabled,busy,profile,refresh,resume,publish,onError,now});this.running=false;}
  schedule(task,origin=null){
    const kind=origin?.kind||task.recovery?.reason;
    if(!this.enabled()||task.mode!=='live'||!['quota','credits'].includes(kind))return false;
    const wait={provider:origin?.provider||task.agent,accountId:origin?.accountId||task.accountId||null,kind};
    const at=quotaReset(this.profile(task,wait)?.quota,this.now());
    task.quotaWait={...wait,status:at?'scheduled':'needs_time',dueAt:at||this.now()+60000,attempts:0};
    if(!['running','handoff'].includes(task.status))task.status='waiting_quota';this.publish();return !!at;
  }
  cancel(task){if(task.gameDemo?.phase==='waiting')task.gameDemo.phase='canceled';if(task.quotaWait){task.quotaWait.status='canceled';task.quotaWait.dueAt=null;}if(task.selfTest&&['waiting','checking','launching'].includes(task.selfTest.phase)){task.selfTest.phase='canceled';task.selfTest.error='模拟验收已取消';}}
  async tick(){
    if(this.running||!this.enabled()||this.busy())return;
    const candidates=this.tasks().filter(t=>pending(t.quotaWait)&&!['running','handoff','completed','idle'].includes(t.status)&&t.recovery?.reason!=='stopped');
    for(const task of candidates){
      const wait=task.quotaWait,profile=this.profile(task,wait);
      if(wait.status==='resuming'){wait.status='scheduled';wait.dueAt=this.now();}
      const snapshotAt=Date.parse(profile?.usageCheckedAt||profile?.checkedAt);
      if(quotaReady(profile,this.now(),wait.kind)&&(wait.lastReady!==true||!wait.lastCheckedAt||snapshotAt>wait.lastCheckedAt)){wait.status='scheduled';wait.dueAt=this.now();}
      else if(wait.status==='needs_time'){
        const at=quotaReset(profile?.quota,this.now());if(at){wait.status='scheduled';wait.dueAt=at;}
      }
      if(wait.status==='needs_time'&&!wait.dueAt)wait.dueAt=this.now()+60000;
    }
    const task=candidates.find(t=>['scheduled','needs_time'].includes(t.quotaWait.status)&&t.quotaWait.dueAt<=this.now());
    if(!task)return;
    this.running=true;const wait=task.quotaWait;
    const backoff=()=>{wait.attempts++;wait.status='needs_time';wait.dueAt=this.now()+Math.min(30*60000,60000*2**Math.min(wait.attempts,5));};
    try {
      await this.refresh(task,wait);
      wait.lastCheckedAt=this.now();
      if(task.quotaWait!==wait||wait.status==='canceled'||!this.enabled()||this.busy()||task.recovery?.reason==='stopped')return;
      const profile=this.profile(task,wait);
      wait.lastReady=quotaReady(profile,this.now(),wait.kind);
      if(quotaReady(profile,this.now(),wait.kind)){
        wait.status='resuming';this.publish();await this.resume(task,wait);
        if(task.quotaWait===wait&&wait.status==='resuming'){wait.status='continued';wait.dueAt=null;}
      }else if(profile?.session==='signed_out'){wait.status='needs_auth';wait.dueAt=null;}
      else{backoff();const at=quotaReset(profile?.quota,this.now());if(at&&at>this.now()+1000){wait.status='scheduled';wait.dueAt=at;}}
    }catch(error){if(wait.status==='canceled'||task.quotaWait!==wait||!this.enabled())return;wait.lastCheckedAt=this.now();wait.lastReady=quotaReady(this.profile(task,wait),this.now(),wait.kind);wait.error=String(error.message).slice(0,300);backoff();this.onError?.(task,error);}
    finally{this.running=false;this.publish();}
  }
}
