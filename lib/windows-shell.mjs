import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);
export async function openDesktopFile(fullPath,action,{execute=run,platform=process.platform}={}){
 if(platform!=='win32')throw Error('系统打开当前仅支持 Windows');
 if(!['reveal','open-folder','open'].includes(action))throw Error('不支持的文件操作');
 const absolute=path.resolve(fullPath);
 const target=action==='open-folder'?path.dirname(absolute):absolute;
 const executable=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
 try{
  await execute(executable,['-NoProfile','-NonInteractive','-STA','-File',fileURLToPath(new URL('./windows-shell.ps1',import.meta.url))],{
   windowsHide:true,timeout:15000,maxBuffer:16384,
   env:{...process.env,AGENT_DESK_SHELL_PATH:target,AGENT_DESK_SHELL_ACTION:action}
  });
 }catch(error){throw Error(`Windows 打开失败：${error.stderr?.trim()||error.message}`);}
 return {ok:true,action};
}

export async function chooseProjectFolder(){
 if(process.platform!=='win32')throw Error('请直接输入项目文件夹路径');
 const executable=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
 const {stdout}=await run(executable,['-NoProfile','-STA','-File',fileURLToPath(new URL('./project-folder-picker.ps1',import.meta.url))],{windowsHide:true,timeout:180000,maxBuffer:16000});
 return JSON.parse(stdout.replace(/^\uFEFF/,''));
}
