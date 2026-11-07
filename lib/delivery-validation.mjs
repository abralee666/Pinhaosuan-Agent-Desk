import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

export function expectedDeliveryFiles(value=[]){
  if(!Array.isArray(value)||value.length>20)throw Error('交付文件清单必须为数组，最多20项');
  return [...new Set(value.map(name=>{
    if(typeof name!=='string'||!name.trim()||name.length>300||/[\x00-\x1f:]/.test(name))throw Error('交付文件必须是任务内相对路径');
    const normalized=name.replace(/\\/g,'/');
    if(normalized.startsWith('/')||normalized.split('/').some(p=>!p||p==='..'||p==='.'))throw Error('交付文件不得越过任务工作区');
    return normalized;
  }))];
}

function inspect(workspace,name){
  let current=path.resolve(workspace);
  // Do not follow junctions or symlinks in either the file or its parents.
  for(const part of name.split('/')){
    current=path.join(current,part);
    try{if(fs.lstatSync(current).isSymbolicLink())throw Error('交付路径包含符号链接');}
    catch(error){if(error.code==='ENOENT')return {name,state:'missing'};throw error;}
  }
  const stat=fs.statSync(current);
  if(!stat.isFile())return {name,state:'not_file'};
  if(stat.size===0)return {name,state:'empty',bytes:0};
  if(stat.size>5*1024*1024)return {name,state:'too_large',bytes:stat.size};
  return {name,state:'present',bytes:stat.size,sha256:createHash('sha256').update(fs.readFileSync(current)).digest('hex')};
}

export function deliverySnapshot(workspace,names){return names.map(name=>inspect(workspace,name));}

export function validateDelivery({workspace,expectedFiles=[],before=[],response=''}){
  const files=deliverySnapshot(workspace,expectedFiles).map(file=>{
    const previous=before.find(p=>p.name===file.name);
    if(file.state==='present')file.state=previous?.sha256===file.sha256?'unchanged':previous?.sha256?'updated':'created';
    return file;
  });
  const missing=files.filter(f=>!['created','updated'].includes(f.state));
  if(missing.length)return {verified:false,files,error:`交付未通过文件校验：${missing.map(f=>`${f.name}（${f.state}）`).join('、')}。官方回合结束不代表文档已生成。请先核对已有产出再决定是否重试。`};
  if(!files.length&&!String(response).trim())return {verified:false,files,error:'Antigravity 回合返回 SUCCESS，但正文为空且未声明可验证的交付文件；不能确认分工完成。请先核对产出，勿盲目重复执行。'};
  return {verified:true,files,error:null};
}
