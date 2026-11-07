import {execFile} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const run=(command,args)=>new Promise((resolve,reject)=>execFile(command,args,{windowsHide:true,timeout:6000,maxBuffer:2*1024*1024},(error,out)=>error?reject(error):resolve(out)));
export function agentExecutableOverride(provider,{env=process.env,fileExists=fs.existsSync}={}){
  const value=env[provider==='codex'?'AGENT_DESK_CODEX_PATH':'AGENT_DESK_ANTIGRAVITY_PATH'];
  if(!value)return null;
  if(!path.isAbsolute(value)||!fileExists(value))throw Error('自定义 Agent 路径须指向已存在的绝对文件路径');
  return value;
}
export const localProviders=[
  {id:'codex',name:'Codex',command:'codex',processes:['codex.exe','codex','codex app.exe'],ready:true},
  {id:'antigravity',name:'Antigravity',command:'agy',folder:'antigravity',exe:'Antigravity.exe',processes:['antigravity.exe','antigravity','agy.exe','agy'],ready:true},
  {id:'cursor',name:'Cursor',command:'cursor',folder:'cursor',exe:'Cursor.exe',processes:['cursor.exe','cursor']},
  {id:'claude',name:'Claude Code',command:'claude',processes:['claude.exe','claude']},
  {id:'coze',name:'Coze',processes:['coze.exe','coze','扣子.exe']},
  {id:'workbuddy',name:'WorkBuddy',command:'workbuddy',folder:'WorkBuddy',exe:'WorkBuddy.exe',processes:['workbuddy.exe','workbuddy']},
  {id:'kiro',name:'Kiro',command:'kiro',folder:'Kiro',exe:'Kiro.exe',processes:['kiro.exe','kiro']},
];
export async function detectLocalAgents({platform=process.platform,env=process.env,fileExists=fs.existsSync,lookupCommand,listProcesses}={}){
  lookupCommand??=async name=>{try{const out=await run(platform==='win32'?'where.exe':'which',[name]);return out.trim().split(/\r?\n/).find(s=>s&&!s.endsWith('.ps1'))||null;}catch{return null;}};
  listProcesses??=async()=>{const out=await run(platform==='win32'?'tasklist.exe':'ps',platform==='win32'?['/FO','CSV','/NH']:['-A','-o','comm=']);return out.split(/\r?\n/).map(line=>platform==='win32'?line.match(/^"([^"]+)"/)?.[1]:path.basename(line.trim())).filter(Boolean);};
  let names=[],processError=null;
  try{names=(await listProcesses()).map(name=>name.toLowerCase());}catch{processError='暂时无法读取运行状态，请重新检测。';}
  const agents=await Promise.all(localProviders.map(async p=>{
    let command=p.ready?agentExecutableOverride(p.id,{env,fileExists}):null;
    command||=p.command?await lookupCommand(p.command):null;
    if(!command&&p.id==='antigravity'&&platform==='win32'){
      const fallback=path.join(env.LOCALAPPDATA||'','agy','bin','agy.exe');
      if(fileExists(fallback))command=fallback;
    }
    if(!command&&p.id==='codex'&&platform==='win32'){
      const arch=process.arch==='arm64'?'arm64':'x64',triple=arch==='arm64'?'aarch64-pc-windows-msvc':'x86_64-pc-windows-msvc';
      const bundled=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','node_modules',`@openai/codex-win32-${arch}`,'vendor',triple,'bin','codex.exe');
      if(fileExists(bundled))command=bundled;
      else {
        const codexDir=path.join(env.LOCALAPPDATA||'','OpenAI','Codex','bin');
        if(fileExists(codexDir)){
          try{
            const entries=fs.readdirSync(codexDir);
            for(const sub of entries){
              const candidate=path.join(codexDir,sub,'codex.exe');
              if(fileExists(candidate)){command=candidate;break;}
            }
          }catch{}
        }
      }
    }
    const desktop=p.folder&&platform==='win32'?path.join(env.LOCALAPPDATA||'', 'Programs',p.folder,p.exe):null;
    const running=processError?null:p.processes.some(name=>names.includes(name));
    const installed=!!command||!!(desktop&&fileExists(desktop))||running===true;
    return {id:p.id,name:p.name,installed,running,canConnect:!!p.ready&&!!command,available:!!p.ready,login:'unknown',detail:!p.ready?'该平台接入能力正在开发中':command?'可检查并复用本机登录会话':installed?'已发现桌面应用，尚未找到后台连接命令':'未检测到本机安装'};
  }));
  return {agents,processError,checkedAt:new Date().toISOString()};
}
