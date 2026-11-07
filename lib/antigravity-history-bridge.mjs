import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Explicitly enabled from the desktop UI; preserve all unrelated official settings.
export function configureAntigravityHistory({dataFile,localHome,home=os.homedir()}={}){
  const file=path.join(home,'.gemini','config','mcp_config.json');
  if(fs.existsSync(file)&&fs.lstatSync(file).isSymbolicLink())throw Error('MCP 配置为链接，请在官方 CLI 手动配置历史工具');
  const original=fs.existsSync(file)?fs.readFileSync(file,'utf8'):'';
  let config;try{config=original.trim()?JSON.parse(original):{};}catch{throw Error('官方 MCP 配置无法解析，未修改');}
  if(!config||Array.isArray(config)||typeof config!=='object'||config.mcpServers&&(typeof config.mcpServers!=='object'||Array.isArray(config.mcpServers)))throw Error('官方 MCP 配置格式无效');
  const script=fileURLToPath(new URL('../scripts/history-mcp.mjs',import.meta.url));
  const prior=config.mcpServers?.agent_desk_history;
  if(prior&&prior.args?.[0]!==script)throw Error('已存在同名历史工具，请先在官方 CLI 检查配置');
  const settingsFile=path.join(home,'.gemini','antigravity-cli','settings.json');
  if(fs.existsSync(settingsFile)&&fs.lstatSync(settingsFile).isSymbolicLink())throw Error('官方设置为链接，请手动配置历史工具权限');
  const settingsOriginal=fs.existsSync(settingsFile)?fs.readFileSync(settingsFile,'utf8'):'';
  let settings;try{settings=settingsOriginal.trim()?JSON.parse(settingsOriginal):{};}catch{throw Error('官方设置无法解析，未修改');}
  if(!settings||typeof settings!=='object'||Array.isArray(settings)||settings.permissions&&(typeof settings.permissions!=='object'||Array.isArray(settings.permissions)))throw Error('官方权限设置格式无效');
  const permissions=settings.permissions||{};
  if(permissions.allow!==undefined&&!Array.isArray(permissions.allow))throw Error('官方权限列表格式无效');
  settings.permissions={...permissions,allow:[...new Set([...(permissions.allow||[]),'mcp(agent_desk_history/search_conversations)','mcp(agent_desk_history/read_conversation)'])]};
  config.mcpServers={...config.mcpServers,agent_desk_history:{command:process.execPath,args:[script,dataFile,localHome],disabled:false}};
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.mkdirSync(path.dirname(settingsFile),{recursive:true});
  if(original)fs.writeFileSync(file+'.agent-desk-backup-'+Date.now(),original,{mode:0o600,flag:'wx'});
  if(settingsOriginal)fs.writeFileSync(settingsFile+'.agent-desk-backup-'+Date.now(),settingsOriginal,{mode:0o600,flag:'wx'});
  fs.writeFileSync(file,JSON.stringify(config,null,2)+'\n',{mode:0o600});
  try{fs.writeFileSync(settingsFile,JSON.stringify(settings,null,2)+'\n',{mode:0o600});}
  catch(error){if(original)fs.writeFileSync(file,original);else fs.unlinkSync(file);throw error;}
  return {enabled:true,restartRequired:true};
}
