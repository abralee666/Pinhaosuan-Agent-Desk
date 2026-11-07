import fs from 'node:fs';
import path from 'node:path';
export function statuslineIdentity(value){
 const email=typeof value?.email==='string'?value.email.trim():'';
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)return null;
 const plan=typeof value.plan_tier==='string'&&/^[\w .+-]{1,60}$/.test(value.plan_tier)?value.plan_tier:null;
 return {email,planType:plan,source:'official-statusline',observedAt:new Date().toISOString()};
}
export function readStatuslineIdentity(file,now=Date.now()){
 try{if(fs.statSync(file).size>4096)return null;const value=JSON.parse(fs.readFileSync(file,'utf8'));if(value.source!=='official-statusline'||!Number.isFinite(Date.parse(value.observedAt))||now-Date.parse(value.observedAt)>60000||Date.parse(value.observedAt)>now+5000)return null;const parsed=statuslineIdentity({email:value.email,plan_tier:value.planType});return parsed?{...parsed,observedAt:value.observedAt}:null;}catch{return null;}
}
