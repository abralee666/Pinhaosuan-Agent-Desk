import pty from 'node-pty';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {antigravityEnvironment} from './agent-env.mjs';import {readStatuslineIdentity} from './antigravity-statusline.mjs';
export class AntigravitySession {
 constructor({identityFile,spawn=pty.spawn,read=readStatuslineIdentity,timeout=20000}={}){this.identityFile=identityFile;this.spawn=spawn;this.read=read;this.timeout=timeout;this.pending=null;this.child=null;this.cancel=null;}
 query(command){if(this.pending)return this.pending;this.pending=this.collect(command).finally(()=>{this.pending=null;});return this.pending;}
 collect(command){return new Promise((resolve,reject)=>{
  const started=Date.now();let settled=false;let firstSeen=null;let child;let timer;let deadline;let output='';
  const finish=(error,value)=>{if(settled)return;settled=true;clearInterval(timer);clearTimeout(deadline);this.child=null;this.cancel=null;try{child?.kill();}catch{}error?reject(error):resolve(value);};
  this.cancel=()=>finish(new Error('账号信息查询已停止。'));
  try{child=this.spawn(command,[],{name:'xterm-256color',cols:100,rows:30,cwd:os.homedir(),env:antigravityEnvironment()});this.child=child;}catch{finish(new Error('无法启动 Antigravity 后台会话。'));return;}
  child.onData(data=>{output=(output+data).slice(-12000);if(data.includes('\x1b[6n'))child.write('\x1b[1;1R');if(/Terms of Service & Data Use|Choose your color scheme/.test(output))finish(new Error('请先运行 agy，完成官方 CLI 首次设置。'));if(/Do you trust the contents/.test(output))finish(new Error('请先在官方 CLI 确认本机用户目录的工作区权限。'));});
  child.onExit(()=>{if(!settled)finish(new Error('Antigravity 后台会话提前退出，账号信息未确认。'));});
  const poll=()=>{const value=this.read(this.identityFile);if(value&&Date.parse(value.observedAt)>=started){firstSeen||=Date.now();if(value.planType||Date.now()-firstSeen>=8000)finish(null,value);}};
  timer=setInterval(poll,200);deadline=setTimeout(()=>{const value=this.read(this.identityFile);if(value&&Date.parse(value.observedAt)>=started)finish(null,value);else finish(new Error('账号信息查询超时，请检查 Antigravity 登录与网络状态。'));},this.timeout);
 });}
 stop(){this.cancel?.();}
}
export function configureAccountBridge(root,identityFile,{home=os.homedir(),platform=process.platform,nodePath=process.execPath}={}){
 const settingsFile=path.join(home,'.gemini','antigravity-cli','settings.json');
 const settings=fs.existsSync(settingsFile)?JSON.parse(fs.readFileSync(settingsFile,'utf8').replace(/^\uFEFF/,'')):{};
 const wrapper=path.join(path.dirname(identityFile),'agent-bridge',platform==='win32'?'agy-statusline.cmd':'agy-statusline.sh');
 if(settings.statusLine?.command&&!settings.statusLine.command.includes('agy-statusline'))throw new Error('已有自定义 Antigravity 状态栏，账号同步配置尚未启用。');
 fs.mkdirSync(path.dirname(wrapper),{recursive:true});
 const script=path.join(root,'scripts','agy-statusline.mjs');
 const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
 fs.writeFileSync(wrapper,platform==='win32'?`@echo off\r\n"${nodePath}" "${script}" "${identityFile}"\r\n`:`#!/bin/sh\nexec ${quote(nodePath)} ${quote(script)} ${quote(identityFile)}\n`,{mode:0o700});
 const next={...settings,statusLine:{...settings.statusLine,type:'command',command:platform==='win32'?`"${wrapper}"`:quote(wrapper),enabled:true,stack_with_default:true}};
 if(JSON.stringify(next)!==JSON.stringify(settings)){fs.mkdirSync(path.dirname(settingsFile),{recursive:true});fs.writeFileSync(settingsFile,JSON.stringify(next,null,2));}
}
