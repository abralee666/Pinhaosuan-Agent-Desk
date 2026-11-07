import readline from 'node:readline';
import {delegationTools} from '../lib/platform-delegation.mjs';
const [url,clientId]=process.argv.slice(2),token=process.env.AGENT_DESK_PLATFORM_TOKEN;
if(!/^http:\/\/127\.0\.0\.1:\d+\/internal\/delegate$/.test(url||'')||!token||!clientId)throw Error('缺少后台分工配置');
const send=value=>process.stdout.write(JSON.stringify(value)+'\n');
async function handle(msg){
  if(msg.id===undefined)return;
  let result;
  if(msg.method==='initialize')result={protocolVersion:msg.params?.protocolVersion||'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'agent-desk-platform',version:'1.0.0'}};
  else if(msg.method==='ping')result={};
  else if(msg.method==='tools/list')result={tools:delegationTools};
  else if(msg.method==='tools/call'){
    try{
      if(msg.params?.name!=='delegate_antigravity')throw Error('未知分工工具');
      const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({clientId,args:msg.params.arguments}),signal:AbortSignal.timeout(230000)});
      const value=await response.json();
      result={content:[{type:'text',text:JSON.stringify(value)}],isError:!response.ok||value.status!=='completed'};
    }catch(error){result={content:[{type:'text',text:String(error.message).slice(0,500)}],isError:true};}
  }else{return send({jsonrpc:'2.0',id:msg.id,error:{code:-32601,message:'Method not found'}});}
  send({jsonrpc:'2.0',id:msg.id,result});
}
readline.createInterface({input:process.stdin}).on('line',line=>{try{void handle(JSON.parse(line));}catch{send({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}});}}).on('close',()=>process.exit(0));
