import {verify, randomUUID} from 'node:crypto';
export const PLANS = Object.freeze([
  {id:'free',name:'Free',monthly:0,annual:0,platforms:1,accounts:1,remote:false},
  {id:'basic',name:'Plus',monthly:9.9,annual:95,platforms:2,accounts:2,remote:true},
  {id:'plus',name:'Ultra',monthly:19.9,annual:191,platforms:5,accounts:5,remote:true},
  {id:'unlimited',name:'Pro',monthly:29.9,annual:287,platforms:null,accounts:null,remote:true},
  {id:'max',name:'Max',monthly:199.9,annual:1199.9,platforms:null,accounts:null,remote:true,humanSupportMonthly:2,limitedAvailability:true},
]);
export function verifyLicense(token, publicKey, installationId, now=Date.now()) {
  try {
    if(typeof token!=='string'||token.length>8192||!publicKey) return null;
    const [payload,signature,...extra]=token.split('.');
    if(extra.length||!payload||!signature||!verify(null,Buffer.from(payload),publicKey,Buffer.from(signature,'base64url')))return null;
    const value=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));
    if(value.version!==1||value.installationId!==installationId||!PLANS.some(p=>p.id===value.plan&&p.remote)||!Number.isFinite(value.expiresAt)||value.expiresAt<=now||value.expiresAt-now>370*86400000)return null;
    return value;
  }catch{return null;}
}
export class Membership {
  constructor(state, {publicKey='',now=Date.now,edition='commercial'}={}) {
    this.state=state;this.publicKey=publicKey;this.now=now;this.edition=edition;
    state.membership ||= {installationId:randomUUID(),license:null,slots:[]};
    state.membership.slots ||= [];
  }
  plan(){if(this.edition==='opensource')return {...PLANS.at(-1),monthly:0,annual:0,humanSupportMonthly:0,limitedAvailability:false};const license=verifyLicense(this.state.membership.license,this.publicKey,this.state.membership.installationId,this.now());return PLANS.find(p=>p.id===license?.plan)||PLANS[0];}
  snapshot(){const license=this.edition==='opensource'?null:verifyLicense(this.state.membership.license,this.publicKey,this.state.membership.installationId,this.now());return {edition:this.edition,plan:this.plan(),plans:this.edition==='opensource'?[this.plan()]:PLANS,installationId:this.state.membership.installationId,expiresAt:license?.expiresAt||null,slots:this.state.membership.slots,quotaResume:this.state.quotaResumeEnabled!==false,adapters:['codex','antigravity']};}
  activate(token){if(!verifyLicense(token,this.publicKey,this.state.membership.installationId,this.now()))throw Object.assign(new Error('授权无效、已到期，或与本机不匹配'),{statusCode:403});this.state.membership.license=token;}
  slots(){const plan=this.plan(),result=[];for(const slot of this.state.membership.slots){if(result.some(s=>s.provider===slot.provider&&s.accountId===slot.accountId))continue;if(plan.accounts!==null&&result.filter(s=>s.provider===slot.provider).length>=plan.accounts)continue;if(plan.platforms!==null&&new Set([...result.map(s=>s.provider),slot.provider]).size>plan.platforms)continue;result.push(slot);}return result;}
  assertRemote(){if(!this.plan().remote)throw Object.assign(new Error('跨网络控制需要有效的付费授权；免费版可以使用局域网'),{statusCode:403,code:'upgrade_required'});}
  assertAdmission(provider,accountId){const before=this.state.membership.slots;try{this.claim(provider,accountId);}finally{this.state.membership.slots=before;}}
  claim(provider,accountId){
    const slots=this.slots();if(slots.some(s=>s.provider===provider&&s.accountId===accountId))return;
    const plan=this.plan();if(plan.accounts!==null&&slots.filter(s=>s.provider===provider).length>=plan.accounts||plan.platforms!==null&&new Set([...slots.map(s=>s.provider),provider]).size>plan.platforms)throw Object.assign(new Error(`${plan.name}最多接入 ${plan.platforms} 个平台，每个平台 ${plan.accounts} 个账号。请先释放已有接入名额或升级`),{statusCode:403,code:'plan_limit'});
    this.state.membership.slots=[...slots,{provider,accountId}];
  }
  release(provider,accountId){this.state.membership.slots=this.state.membership.slots.filter(s=>s.provider!==provider||s.accountId!==accountId);}
}
