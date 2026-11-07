export const activeWriterConflict = text => /\bthread\b[^\r\n]*already has an active writer/i.test(text)||/原生会话写入权.*占用/.test(text);
export const recoverableTask = task => task?.mode==='live'&&['failed','interrupted','waiting_account','waiting_agent','waiting_quota'].includes(task.status);
export function recoveryReason(text='',stopped=false){
  if(stopped)return 'stopped';
  if(activeWriterConflict(text))return 'writer_conflict';
  if(/unauthorized|authentication (?:failed|required)|token.{0,20}(?:expired|revoked)|登录已失效|请先.*登录|login required|not authenticated|401/i.test(text))return 'authorization';
  if(/连接中断|后台已退出|connection (?:closed|lost|reset)|process exited|\bEOF\b|ECONNRESET|ETIMEDOUT|fetch failed/i.test(text))return 'disconnect';
  return 'execution';
}
export function recoveryPrompt(task){
  if(!recoverableTask(task))throw Error('只有暂停或失败的任务可以恢复');
  return `恢复尚未完成的请求：${task.currentPrompt||task.goal}。先核对共享上下文、已有文件和检查点；保留已完成结果，不重复已完成操作。对于中断前执行结果不确定的操作，先检查结果，不直接重复。`;
}
export const missingThread = text => /thread (?:not found|does not exist)|(?:unknown|missing) thread|no rollout found/i.test(text);
