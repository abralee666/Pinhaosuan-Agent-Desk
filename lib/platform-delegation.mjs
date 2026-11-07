import {randomUUID} from 'node:crypto';
import {executionPolicy} from './execution.mjs';
import {cleanReport} from './antigravity.mjs';
import {expectedDeliveryFiles,deliverySnapshot,validateDelivery} from './delivery-validation.mjs';

export const delegationTools=[{name:'delegate_antigravity',description:'通过拼好算后台已登录的 Antigravity 执行当前任务的一项分工，等待真实结果。工作区与联网权限必须已开启。无需也不得在 Codex 沙箱中运行 agy 或复制凭据。保留用户的上传前审核要求。失败会返回官方错误，不会自动换模型。',inputSchema:{type:'object',properties:{requestId:{type:'string',description:'本回合内唯一的分工标识；相同标识重试返回同一结果'},prompt:{type:'string',description:'具体分工、需要读取的任务内文件和交付要求'},expectedFiles:{type:'array',items:{type:'string'},maxItems:20,description:'文件任务必须填写所有目标文件的任务内相对路径；纯文字任务填空数组。仅新建或内容更新的非空文件通过交付校验。'},model:{type:'string',description:'可选；默认使用任务中已选的 Antigravity 模型'},effort:{type:'string',description:'可选；默认使用任务中已选的推理强度'}},required:['requestId','prompt','expectedFiles'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:true}}];

export function antigravityFailure(text){
  const error=cleanReport(String(text||'Antigravity 未返回成功结果')).slice(-2000);
  if(/Eligibility check failed/i.test(error)&&/EOF/i.test(error))return `Antigravity 官方资格检查失败：读取 Google 验证服务时连接中断（EOF），尚未开始模型推理。请检查当前网络及已启用代理的连通性。官方错误：${error}`;
  return /User location is not supported/i.test(error)?`Antigravity 官方服务拒绝执行：当前访问地区不受支持。登录状态和剩余额度不代表模型可执行。官方错误：${error}`:error;
}

// Runs under the desktop service, never inside the Codex command sandbox.
// The caller supplies no task id, path, account, command or environment.
export class PlatformDelegation{
  constructor({context,prepare,start,changed=()=>{}}){Object.assign(this,{context,prepare,start,changed});this.pending=new Map();}
  async call(clientId,args={}){
    const ctx=this.context(clientId),{task,run}=ctx;
    if(run.canceled||!['workspace','full-access'].includes(task.executionMode)||task.networkAccess!==true)throw Error('跨平台分工需要当前任务的工作区执行及允许联网权限');
    if(!/^[\w.-]{1,80}$/.test(args.requestId||'')||typeof args.prompt!=='string'||!args.prompt.trim()||args.prompt.length>6000)throw Error('分工标识无效或分工内容超过6000字符');
    for(const key of Object.keys(args))if(!['requestId','prompt','expectedFiles','model','effort'].includes(key))throw Error('不支持指定其他任务、工作目录或账号');
    if(!Array.isArray(args.expectedFiles))throw Error('请显式填写 expectedFiles：文件任务列出目标相对路径，纯文字任务填空数组');
    expectedDeliveryFiles(args.expectedFiles);
    const key=`${task.id}:${run.id}:${args.requestId}`;
    if(this.pending.has(key)){
      const previous=this.pending.get(key);
      if(JSON.stringify(args)!==previous.input)throw Error('同一分工标识不能用于不同请求');
      return previous.promise;
    }
    if([...this.pending.values()].some(p=>p.run===run&&!p.ended))throw Error('当前已有 Antigravity 分工正在执行，请等待结果');
    const entry={run,input:JSON.stringify(args),ended:false};
    this.pending.set(key,entry);
    entry.promise=this.execute(clientId,ctx,args,entry);
    return entry.promise;
  }
  async execute(clientId,ctx,args,entry){
    const {task,run}=ctx;
    let prepared;
    try{prepared=await this.prepare(task,args);if(this.context(clientId).run!==run||run.canceled||entry.ended)throw Error('原回合已停止，未启动分工');}
    catch(error){entry.ended=true;throw error;}
    const {command,settings,accountId}=prepared;
    const expectedFiles=expectedDeliveryFiles(args.expectedFiles);
    let before;try{before=deliverySnapshot(task.workspace,expectedFiles);}catch(error){entry.ended=true;throw error;}
    task.deliveryRequirements||={};task.deliveryRequirements.antigravity=[...expectedFiles];
    const job={id:randomUUID(),requestId:args.requestId,agent:'antigravity',...settings,accountId,expectedFiles,status:'running',startedAt:new Date().toISOString()};
    task.delegations||=[];task.delegations.push(job);this.changed(task,job,'start');
    const childTask={...task,threads:{}};
    const text=`${executionPolicy(task).instructions}只处理以下分工，不上传、不发布、不选择许可证，不启动其他平台或递归分工。不要修改任务工作区外的文件。任务目标：${task.goal}\n用户当前请求：${task.currentPrompt||task.goal}\n分工：${args.prompt}\n必须交付并核对的文件：${JSON.stringify(expectedFiles)}。文件应写入上述当前任务工作区，结束时说明实际完成的文件和未完成的事项。若涉及交付文件，请直接使用内置 write_file 或编辑工具创建/写入文件，切勿使用终端命令行工具（如 run_command/PowerShell）写入交付文件。若工具失败或受限，请明确返回原因，不得空白结束。`;
    return new Promise(resolve=>{
      let output='';
      const settle=(status,error=null,response='')=>{
        if(entry.ended)return;
        let failureCategory=null;
        if(status==='completed'){
          try{job.delivery=validateDelivery({workspace:task.workspace,expectedFiles,before,response:response||output});}
          catch(validationError){job.delivery={verified:false,files:[],error:'交付校验失败：'+validationError.message};}
          if(!job.delivery.verified){status='failed';error=job.delivery.error;failureCategory='交付文件缺失';}
        }else if(status==='failed'){
          if(!job.actualModel&&!job.conversationId&&!output){failureCategory='未启动模型';}
          else{failureCategory='模型执行失败';}
        }
        entry.ended=true;job.status=status;job.finishedAt=new Date().toISOString();
        job.error=error;job.response=(response||output).slice(-18000);
        if(failureCategory)job.failureCategory=failureCategory;
        entry.child?.kill();this.changed(task,job,'finish');
        delete task.deliveryRequirements?.antigravity;
        resolve({jobId:job.id,status,model:job.actualModel||job.resolvedModel,effort:job.effort,response:job.response,error,...(failureCategory?{failureCategory}:{}),...(job.delivery?{delivery:job.delivery}:{})});
      };
      entry.cancel=()=>settle('canceled','父回合已停止，Antigravity 分工已取消');
      try{
        entry.child=this.start(command,childTask,text,event=>{
          if(entry.ended)return;
          if(event.type==='init'){
            job.actualModel=event.model;job.conversationId=event.conversationId;
            if(event.model&&settings.resolvedModel&&event.model!==settings.resolvedModel)return settle('failed',`官方实际模型 ${event.model} 与指定模型 ${settings.resolvedModel} 不一致，已停止分工。`);
          }
          if(event.type==='delta')output=(output+event.text).slice(-18000);
          if(event.type==='tool'){job.tools||=[];job.tools.push({name:event.name,state:event.state});}
          if(event.type==='result'){
            job.upstreamStatus=event.status;job.usage=event.usage||null;
            settle(event.status==='SUCCESS'?'completed':'failed',event.status==='SUCCESS'?null:antigravityFailure(event.error||event.status),event.response);
          }
        },error=>settle('failed',antigravityFailure(error.message)),settings);
        if(entry.ended)entry.child?.kill();
      }catch(error){settle('failed',antigravityFailure(error.message));}
    });
  }
  cancel(run){for(const [key,p]of this.pending)if(p.run===run){if(p.cancel)p.cancel();else p.ended=true;this.pending.delete(key);}}
}
