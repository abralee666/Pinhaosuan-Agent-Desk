import fs from 'node:fs';
import path from 'node:path';
export function desktopAccountIdentity(appData=process.env.APPDATA){
  if(!appData)return null;
  try{
    const file=path.join(appData,'Antigravity','app_storage.json');
    if(fs.statSync(file).size>2*1024*1024)return null;
    const data=JSON.parse(fs.readFileSync(file,'utf8'));
    const email=data['jetski.onboarding.lastLoginUsername'];
    if(typeof email!=='string'||email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))return null;
    return {email:email.trim(),source:'desktop-last-login'};
  }catch{return null;}
}
