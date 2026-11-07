import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {Codex} from './codex.mjs';
import {accountProfile,record} from './account-manager.mjs';
import {normalizeLocalQuota,usageAvailability,mergeQuota} from './local-account.mjs';
import {rankedAccounts,accountPriority} from './account-policy.mjs';

export const nativeCodex=a=>a?.provider==='codex'&&['local-session','isolated-session'].includes(a.source);
export function accountThreadKey(profile){return nativeCodex(profile)?`codex:${profile.id}`:'codex';}
export function nativeQuotaAvailable(a,now=Date.now()){
  if(a.ordinaryUsageAllowed===false||a.executionBlockedUntil>now)return false;
  const time=Date.parse(a.checkedAt),windows=a.quota?.monthly?[a.quota.monthly,...[a.quota.fiveHour,a.quota.weekly].filter(Boolean)]:[a.quota?.fiveHour,a.quota?.weekly];
  return a.enabled&&a.session==='signed_in'&&Number.isFinite(time)&&time<=now&&now-time<5*60*1000&&windows.every(w=>w&&Number.isFinite(w.remaining)&&w.remaining>0);
}
export class CodexAccounts{
  constructor({root,group,desktop,createClient=options=>new Codex(options),publish=()=>{},attach=()=>{},loginTimeoutMs=30*60*1000}){
    Object.assign(this,{root:path.resolve(root),group,desktop,createClient,publish,attach});this.loginTimeoutMs=loginTimeoutMs;this.clients=new Map();this.pending=null;
    // A pending browser callback cannot survive a service restart.
    for(const a of group.accounts.filter(a=>a.source==='isolated-session'&&a.session==='signing_in')){a.session='signed_out';a.loginStatus='登录已中断，请重新授权';}
  }
  home(id){if(!/^[a-f0-9-]{36}$/i.test(id))throw Error('账号标识无效');return path.join(this.root,id);}
  profile(id){const a=this.group.accounts.find(a=>a.id===id);if(!nativeCodex(a))throw Error('该账号未连接官方后台');return a;}
  client(id){const a=this.profile(id);if(a.source==='local-session')return this.desktop;
    if(!this.clients.has(id)){const client=this.createClient({home:this.home(id)});this.clients.set(id,client);this.attach(client,id);client.on('notification',msg=>{
      if(msg.method==='account/login/completed'&&this.pending?.accountId===id&&msg.params?.loginId===this.pending.loginId){
        const success=msg.params?.success;this.clearPending();a.session=success?'signed_in':'signed_out';a.authExpiresAt=null;a.loginStatus=success?'授权完成':'授权未完成，请重试';this.publish();if(success)void this.refresh(id).catch(()=>{});
      }
    });}return this.clients.get(id);
  }
  create(name){name=String(name||'').trim();if(name.length>40)throw Error('账号备注最多40字');
    const a=accountProfile('codex',name||'Codex 账号','官方授权后获取邮箱');a.source='isolated-session';a.customName=!!name;a.loginStatus='尚未授权';
    const home=this.home(a.id);fs.mkdirSync(home,{recursive:true,mode:0o700});
    if(process.platform==='win32'){
      const who=spawnSync('whoami.exe',['/user','/fo','csv','/nh'],{encoding:'utf8',windowsHide:true});const sid=who.stdout?.match(/S-1-5-\d+(?:-\d+)+/)?.[0];
      if(!sid)throw Error('无法确认本机用户，未创建登录连接');
      const acl=spawnSync('icacls.exe',[home,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)F`,'*S-1-5-18:(OI)(CI)F'],{encoding:'utf8',windowsHide:true});
      if(acl.status!==0)throw Error('无法保护账号目录，未启动授权');
    }
    this.group.accounts.push(a);record(this.group,'isolated_account_created',a.id);this.publish();return a;
  }
  async refresh(id){const a=this.profile(id),client=this.client(id);await client.start();
    const {account}=await client.request('account/read',{refreshToken:false});
    if(a.source==='local-session'&&account&&a.email&&account.email?.toLowerCase()!==a.email.toLowerCase())throw Error('该桌面账号当前未登录，请选择独立连接');
    if(!account){a.session='signed_out';a.quota=null;a.checkedAt=null;a.credentialStatus='session_required';this.publish();return a;}
    if(account.type!=='chatgpt')throw Error('请使用 ChatGPT 订阅账号授权');
    Object.assign(a,{email:account.email||null,identifier:account.email||'邮箱未知',plan:account.planType||null,session:'signed_in',credentialStatus:'session_ready',lastVerifiedAt:new Date().toISOString(),error:null});
    if(a.source==='isolated-session'&&!a.customName)a.name=account.planType?`Codex ${account.planType.toUpperCase()}`:'Codex 账号';
    try{
      const raw=await client.request('account/rateLimits/read');
      const normalized=normalizeLocalQuota(raw);
      if(normalized)a.quota=mergeQuota(normalized,a.quota);
      else if(raw?.ordinaryUsageAllowed===false){
        a.quota=mergeQuota({fiveHour:{remaining:0,capacity:100,resetsAt:null},weekly:null,monthly:null},a.quota);
        if(a.quota.fiveHour)a.quota.fiveHour.remaining=0;
      }
      Object.assign(a,usageAvailability(raw));
      a.checkedAt=a.quota?new Date().toISOString():a.checkedAt;
    }catch(error){
      const isRateLimit = !/error sending request|connect|timeout|network|socket|tls|handshake|offline|econnreset|econnrefused/i.test(error.message) && /(?:status[_ ]?code\s*[:=]?\s*429|\b429\b|rate_limit_exceeded|exceeded your current quota|too many requests)/i.test(error.message);
      if(isRateLimit){
        a.ordinaryUsageAllowed=false;
        a.quota=mergeQuota({fiveHour:{remaining:0,capacity:100,resetsAt:null},weekly:null,monthly:null},a.quota);
        if(a.quota.fiveHour)a.quota.fiveHour.remaining=0;
        a.checkedAt=new Date().toISOString();
        a.error=null;
      } else {
        a.error='已验证登录，额度暂不可读取：'+error.message;
      }
    }
    this.publish();return a;
  }
  async startLogin(id){const a=this.profile(id);if(a.source!=='isolated-session')throw Error('桌面登录由官方应用管理，请添加独立账号');
    if(this.pending?.accountId===id&&this.pending.authUrl)return {accountId:id,authUrl:this.pending.authUrl,expiresAt:a.authExpiresAt};if(this.pending)throw Error('已有账号等待官方授权，请先完成或取消');
    const client=this.client(id);await client.start();if((await client.request('account/read',{refreshToken:false})).account&&!(a.session==='signed_out'&&a.loginStatus==='登录已失效，请重新授权'))throw Error('此连接已有账号，请刷新或添加新连接');
    this.pending={accountId:id,loginId:null,timer:null};
    try{const result=await client.request('account/login/start',{type:'chatgpt'});const url=new URL(result.authUrl);
      if(url.protocol!=='https:'||!['auth.openai.com','chatgpt.com'].includes(url.hostname)||!result.loginId)throw Error('官方登录地址无法验证');
      this.pending.loginId=result.loginId;this.pending.authUrl=url.href;a.authExpiresAt=new Date(Date.now()+this.loginTimeoutMs).toISOString();this.pending.timer=setTimeout(()=>void this.cancelLogin(id,'expired').catch(()=>{}),this.loginTimeoutMs);this.pending.timer.unref?.();
      a.session='signing_in';a.loginStatus='等待浏览器授权';record(this.group,'isolated_login_started',id);this.publish();return {accountId:id,authUrl:url.href,expiresAt:a.authExpiresAt};
    }catch(error){this.clearPending();a.session='signed_out';a.loginStatus='无法启动授权，请重试';this.publish();throw error;}
  }
  clearPending(){if(this.pending?.timer)clearTimeout(this.pending.timer);this.pending=null;}
  async cancelLogin(id,reason='manual'){if(this.pending?.accountId!==id)return;const pending=this.pending;this.clearPending();
    try{if(pending.loginId)await this.client(id).request('account/login/cancel',{loginId:pending.loginId});}
    finally{const a=this.profile(id);a.session='signed_out';a.authExpiresAt=null;a.loginStatus=reason==='expired'?'授权已过期，请重新打开官方登录':'授权已取消';record(this.group,reason==='expired'?'isolated_login_expired':'isolated_login_canceled',id);this.publish();}
  }
  async activate(id){const a=await this.refresh(id);if(!a.enabled||a.session!=='signed_in')throw Error('账号尚未授权或登录已失效');
    // Selection never logs out another client or copies its authentication files.
    this.group.activeAccountId=id;record(this.group,'native_account_selected',id);this.publish();return {profile:a,client:this.client(id)};
  }
  async next(task,allowed=()=>true){task.accountAttempts||=[];if(task.accountId&&!task.accountAttempts.includes(task.accountId))task.accountAttempts.push(task.accountId);
    for(const a of rankedAccounts(this.group.accounts)){if(!nativeCodex(a)||!a.enabled||task.accountAttempts.includes(a.id)||!allowed(a))continue;
      task.accountAttempts.push(a.id);try{await this.refresh(a.id);if(nativeQuotaAvailable(a))return await this.activate(a.id);}catch{continue;}
    }return null;
  }
  async preferred(allowed=()=>true){
    const current=this.group.accounts.find(a=>a.id===this.group.activeAccountId);
    if(!this.group.autoSwitch)return null;
    for(const a of rankedAccounts(this.group.accounts)){
      if(!nativeCodex(a)||!a.enabled||a.id===current?.id||accountPriority(a)>=accountPriority(current)||!allowed(a))continue;
      try{await this.refresh(a.id);if(nativeQuotaAvailable(a))return await this.activate(a.id);}catch{}
    }return null;
  }
  stop(){this.clearPending();for(const client of this.clients.values())client.stop();}
}
