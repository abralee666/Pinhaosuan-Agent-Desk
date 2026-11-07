import readline from 'node:readline';
import {digest} from './store.mjs';
const send=data=>process.stdout.write(JSON.stringify(data)+'\n');
readline.createInterface({input:process.stdin}).once('line',async line=>{
  try {
    const pack=JSON.parse(line),{hash,...body}=pack;
    if(digest(body)!==hash)throw new Error('交接包校验失败');
    for(const file of pack.files)if(digest(file.content)!==file.sha256)throw new Error('继承文件校验失败');
    send({type:'received',accountId:pack.account.id,accountName:pack.account.name,pid:process.pid,contextHash:hash,
      memoryIds:pack.memories.map(m=>m.id),completed:pack.completed,model:pack.modelSettings.model,effort:pack.modelSettings.effort});
    for(let i=pack.nextStep;i<pack.totalSteps;i++){
      if(i-pack.nextStep>=pack.account.budget){send({type:'quota'});return;}
      await new Promise(r=>setTimeout(r,400));
      send({type:'step',index:i,label:`多账号验证步骤 ${i+1}`,name:`account-step-${i+1}.json`,content:JSON.stringify({
        step:i+1,accountId:pack.account.id,accountName:pack.account.name,pid:process.pid,model:pack.modelSettings.model,
        effort:pack.modelSettings.effort,inheritedSteps:pack.completed.length,memoryIds:pack.memories.map(m=>m.id),contextHash:hash},null,2)});
    }
    send({type:'done'});
  } catch(error){send({type:'error',text:error.message});process.exitCode=1;}
});
