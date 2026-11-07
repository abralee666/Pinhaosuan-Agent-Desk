import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
export const gameDemoKinds={account:'自动换号',sentinel:'哨兵恢复',relay:'跨平台接力'};
export const gameBasePrompt='制作一个精致、可直接玩的贪吃蛇小游戏，只生成当前工作区 index.html，全部 CSS/JS 内联，不安装依赖、不联网。支持方向键、食物、计分、碰撞结束。以清晰的深色游戏面板呈现。请实际写入文件，不只回复代码。先完成这个基础版本，不提前添加暂停、最高分、触摸控制和难度选择。';
export function gameUpgradePrompt(kind){
  const feature={account:'添加暂停/继续、重新开始和最高分保存。localStorage 必须用 try/catch 兼容受限预览环境。',sentinel:'添加手机触摸方向按钮，适配窄屏，并检查键盘和触屏控制是否冲突。',relay:'先审查已有游戏代码，修复发现的问题，再添加简单、普通、困难三档速度选择。'}[kind];
  if(!feature)throw Error('无效的游戏验收类型');
  return `继续当前贪吃蛇项目。先读取已有 index.html，在原文件中${feature}保留已有功能和视觉风格，不重建其他项目，不安装依赖，不联网。必须实际更新 index.html，最后简短列出改动和需要手动试玩的项目。`;
}
export function readGameFile(task){
  const file=path.join(task.workspace,'index.html');if(!fs.existsSync(file))throw Error('尚未生成 index.html');
  const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>512*1024)throw Error('游戏文件无效或超过 512 KB');
  const html=fs.readFileSync(file,'utf8');if(!/<html[\s>]|<!doctype html/i.test(html)||!/<script[\s>]/i.test(html))throw Error('未检测到完整 HTML 与游戏脚本');
  return {html,hash:createHash('sha256').update(html).digest('hex')};
}
export function createGameDemo(store,kind,profile,settings){
  if(!Object.hasOwn(gameDemoKinds,kind))throw Error('无效的游戏验收类型');
  const task=store.createTask(`贪吃蛇 · ${gameDemoKinds[kind]}演示`,'live');
  Object.assign(task,{agent:'codex',accountId:profile.id,executionMode:'full-access',networkAccess:true,currentPrompt:gameBasePrompt,
    modelSettings:{codex:settings},modelRuns:[{agent:'codex',...settings,at:new Date().toISOString()}],accountAttempts:[],relayAttempted:[],
    gameDemo:{kind,stage:0,phase:'building',sourceAccountId:profile.id}});
  store.event(task,'system','【流程演示】完全访问任务：真实模型制作游戏；只模拟任务限额信号，不修改真实额度。基础版本完成后自动进入接续阶段。','game_demo');
  return task;
}
export function gameWaitingProfile(task,profile,now=Date.now()){
  if(task.gameDemo?.phase!=='waiting'||now>=task.gameDemo.releaseAt)return profile;
  return {...profile,ordinaryUsageAllowed:false,usageCheckedAt:new Date(now).toISOString(),quota:{demo:{remaining:0,resetsAt:task.gameDemo.releaseAt}}};
}
