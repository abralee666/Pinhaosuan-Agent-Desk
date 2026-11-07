import readline from 'node:readline';
import {Codex} from '../lib/codex.mjs';
import {ConversationHistory,historyTools} from '../lib/conversation-history.mjs';
import {AntigravityHistory} from '../lib/antigravity-history.mjs';
const [dataFile,localHome]=process.argv.slice(2);
if(!dataFile||!localHome)throw Error('缺少本机会话查询配置');
const client=new Codex({home:localHome}),history=new ConversationHistory({dataFile,localClient:client,antigravity:new AntigravityHistory()});
const input=readline.createInterface({input:process.stdin});
const send=value=>process.stdout.write(JSON.stringify(value)+'\n');
async function handle(msg){
  if(msg.id===undefined)return;
  try{
    let result;
    if(msg.method==='initialize')result={protocolVersion:msg.params?.protocolVersion||'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'agent-desk-history',version:'1.0.0'}};
    else if(msg.method==='ping')result={};
    else if(msg.method==='tools/list')result={tools:historyTools};
    else if(msg.method==='tools/call'){
      try{const value=await history.call(msg.params?.name,msg.params?.arguments||{});result={content:[{type:'text',text:JSON.stringify(value)}],isError:false};}
      catch(error){result={content:[{type:'text',text:String(error.message).slice(0,500)}],isError:true};}
    }else{send({jsonrpc:'2.0',id:msg.id,error:{code:-32601,message:'Method not found'}});return;}
    send({jsonrpc:'2.0',id:msg.id,result});
  }catch{send({jsonrpc:'2.0',id:msg.id,error:{code:-32603,message:'会话查询失败'}});}
}
input.on('line',line=>{try{void handle(JSON.parse(line));}catch{send({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}});}});
input.on('close',()=>{client.stop();process.exit(0);});
process.on('SIGTERM',()=>{client.stop();process.exit(0);});
