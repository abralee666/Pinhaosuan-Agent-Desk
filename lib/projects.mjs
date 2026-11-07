import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
const key=value=>process.platform==='win32'?value.toLowerCase():value;
function directory(value){
 if(typeof value!=='string'||!value.trim()||!path.isAbsolute(value))throw Error('请输入已有项目文件夹的绝对路径');
 let root;try{root=fs.realpathSync(value.trim());if(!fs.statSync(root).isDirectory())throw Error();}catch{throw Error('项目文件夹不存在或不可访问');}return root;
}
function name(value){if(typeof value!=='string'||!value.trim()||value.trim().length>80)throw Error('项目名称应为 1–80 个字符');return value.trim();}
function instructions(value=''){if(typeof value!=='string'||value.length>12000)throw Error('项目规则最多 12000 个字符');return value;}
export function projectById(store,id){const project=store.state.projects.find(p=>p.id===id);if(!project)throw Error('项目不存在');return project;}
export function createProject(store,input={}){
 const title=name(input.name),rules=instructions(input.instructions);
 const source=input.fromTaskId?store.task(input.fromTaskId):null;
 if(source?.projectId)throw Error('此聊天已经属于一个项目');
 if(input.workspace&&!source)directory(input.workspace);
 const id=randomUUID();
 const workspace=source?directory(source.workspace):input.workspace?directory(input.workspace):path.join(store.root,'projects',id,'workspace');
 if(store.state.projects.some(p=>key(p.workspace)===key(workspace)))throw Error('此文件夹已经关联项目，请使用已有项目');
 if(!source&&!input.workspace)fs.mkdirSync(workspace,{recursive:true});
 const project={id,name:title,workspace,kind:source?'adopted':input.workspace?'external':'managed',instructions:rules,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),archived:false};
 store.state.projects.push(project);
 if(source){source.projectId=id;syncProject(store,source);store.state.selectedTaskId=source.id;}
 else store.state.selectedTaskId=null;
 store.state.selectedProjectId=id;store.save();return project;
}
export function updateProject(store,id,input){
 const project=projectById(store,id);
 if(input.workspace!==undefined&&key(input.workspace)!==key(project.workspace))throw Error('项目目录固定关联，不能重定向已有聊天');
 const changes={};if(input.name!==undefined)changes.name=name(input.name);if(input.instructions!==undefined)changes.instructions=instructions(input.instructions);
 if(input.archived!==undefined){if(typeof input.archived!=='boolean')throw Error('归档状态无效');changes.archived=input.archived;}
 Object.assign(project,changes,{updatedAt:new Date().toISOString()});
 for(const task of store.state.tasks.filter(t=>t.projectId===id))syncProject(store,task);
 store.save();return project;
}
export function syncProject(store,task){
 if(!task.projectId)return task;
 const project=projectById(store,task.projectId);
 // Task and native thread identity stay independent, even when their cwd is shared.
 task.workspace=project.workspace;task.projectKind=project.kind;
 if(!task.storageWorkspace){task.storageWorkspace=path.join(store.root,'session-meta',task.id);fs.mkdirSync(task.storageWorkspace,{recursive:true});}
 task.projectContext={id:project.id,name:project.name,workspace:project.workspace,instructions:project.instructions};return task;
}
export function ensureProjectForTask(store,task){
 if(task.projectId){syncProject(store,task);store.state.selectedProjectId=task.projectId;return;}
 const workspace=directory(task.workspace);
 let project=store.state.projects.find(p=>key(p.workspace)===key(workspace));
 if(!project){project={id:randomUUID(),name:path.basename(workspace)||workspace,workspace,kind:'external',instructions:'',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),archived:false};store.state.projects.push(project);}
 task.projectId=project.id;syncProject(store,task);store.state.selectedProjectId=project.id;
}
export function initializeProjects(store){
 if(!Array.isArray(store.state.projects)){
  if(fs.existsSync(store.file)&&!fs.existsSync(store.file+'.before-projects.json'))fs.copyFileSync(store.file,store.file+'.before-projects.json',fs.constants.COPYFILE_EXCL);
  store.state.projects=[];
 }
 for(const task of store.state.tasks){if(task.projectId)syncProject(store,task);else if(task.nativeSession){try{ensureProjectForTask(store,task);}catch{}}}
 const selected=store.state.tasks.find(t=>t.id===store.state.selectedTaskId);
 store.state.selectedProjectId=selected?selected.projectId||null:store.state.selectedProjectId||null;
}
export function scopedMemories(store,task){
 syncProject(store,task);
 const memories=store.state.memories.map(({id,text})=>({id,text}));
 if(task.projectContext)memories.push({id:'project:'+task.projectId,text:`当前项目：${task.projectContext.name}\n工作目录：${task.workspace}\n用户设置的项目规则：\n${task.projectContext.instructions||'（未设置）'}\n同项目聊天共享此目录中的文件，各聊天消息独立；按需读取文件，其他聊天记录不自动注入。`});
 return memories;
}
