import {deliveryReference,deliveryLinks} from '../public/delivery-path.js';
import fs from 'node:fs';
import path from 'node:path';
const extensions = new Set(['.pdf','.ppt','.pptx','.doc','.docx','.xls','.xlsx','.csv','.txt','.md','.html','.htm','.png','.jpg','.jpeg','.webp','.gif','.svg','.zip','.js','.mjs','.cjs','.ts','.tsx','.jsx','.py','.json','.css','.sql','.yaml','.yml','.toml','.xml','.ipynb','.r','.go','.java','.c','.cpp','.h','.rs','.sh','.ps1']);
export function resolveDeliveryPath(workspace, name) {
  const root = fs.realpathSync(workspace);
  const full = fs.realpathSync(path.resolve(root, name));
  const relative = path.relative(root, full);
  if (!relative || relative.startsWith('..'+path.sep) || relative === '..' || path.isAbsolute(relative) || !fs.statSync(full).isFile()) throw Error('文件不在当前工作区内');
  return full;
}
export function deliveryFiles(task, siblings=[]) {
  const workspace=task.workspace, result=[], seen=new Set();
  const add=name=>{
    try {
      const full=resolveDeliveryPath(workspace,name), rel=path.relative(fs.realpathSync(workspace),full).split(path.sep).join('/');
      if(rel==='context-latest.json'||seen.has(rel)||!extensions.has(path.extname(full).toLowerCase())||rel.split('/').some(p=>p.startsWith('.')))return;
      seen.add(rel);result.push({name:rel,size:fs.statSync(full).size});
    } catch {}
  };
  // Existing projects are never crawled: only explicit assistant file references are inspected.
  if(task.nativeSession||task.projectContext&&!['managed','adopted'].includes(task.projectKind)){
    for(const e of [task,...siblings.filter(t=>t.id!==task.id)].flatMap(t=>t.events||[]))if(['codex','antigravity'].includes(e.actor)&&e.kind==='message')
      for(const match of deliveryLinks(String(e.text))){
        const name=deliveryReference(match.target);
        if(name!==null)add(name);
      }
  }else{
    let visited=0;
    const walk=(dir,depth=0)=>{
      if(depth>8||visited>3000||result.length>=200)return;
      for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
        if(++visited>3000||result.length>=200)break;
        if(entry.name.startsWith('.')||['node_modules','__pycache__','dist','build','coverage','vendor'].includes(entry.name)||entry.isSymbolicLink())continue;
        const full=path.join(dir,entry.name);
        if(entry.isDirectory())walk(full,depth+1);else if(entry.isFile())add(full);
      }
    };try{walk(workspace);}catch{}
  }
  return result;
}
