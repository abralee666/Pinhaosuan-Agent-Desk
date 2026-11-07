import {spawnSync} from 'node:child_process';
export function proxyEnvironment(env,server){
  if(env.HTTPS_PROXY||env.https_proxy||env.ALL_PROXY||env.all_proxy||!server)return {...env};
  const choices=String(server).split(';');
  const chosen=choices.find(s=>s.startsWith('https='))||choices.find(s=>s.startsWith('http='))||choices.find(s=>!s.includes('='));
  if(!chosen)return {...env};
  const address=chosen.replace(/^(?:https|http)=/,'').trim();
  try{
    const url=new URL(address.includes('://')?address:'http://'+address);
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return {...env};
    return {...env,HTTPS_PROXY:url.href,HTTP_PROXY:env.HTTP_PROXY||env.http_proxy||url.href,NO_PROXY:env.NO_PROXY||env.no_proxy||'localhost,127.0.0.1,::1'};
  }catch{return {...env};}
}
export function antigravityEnvironment(){
  const env={...process.env};
  if(process.platform!=='win32'||env.HTTPS_PROXY||env.https_proxy||env.ALL_PROXY||env.all_proxy)return env;
  const key='HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
  const read=name=>spawnSync('reg.exe',['query',key,'/v',name],{encoding:'utf8',windowsHide:true,timeout:2000}).stdout||'';
  if(!/ProxyEnable\s+REG_DWORD\s+0x1\b/.test(read('ProxyEnable')))return env;
  const server=read('ProxyServer').match(/ProxyServer\s+REG_SZ\s+(.+)/)?.[1]?.trim();
  return proxyEnvironment(env,server);
}
