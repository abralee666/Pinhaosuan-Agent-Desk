const fields=['inputTokens','cachedInputTokens','cacheWriteInputTokens','outputTokens','reasoningOutputTokens','totalTokens'];
function counters(value){
  if(!value||!Number.isFinite(value.inputTokens)||!Number.isFinite(value.outputTokens)||!Number.isFinite(value.totalTokens))return null;
  return Object.fromEntries(fields.map(k=>[k,Number.isFinite(value[k])&&value[k]>=0?value[k]:null]));
}
export function recordTokenUsage(task,params){
  const total=counters(params.tokenUsage?.total),last=counters(params.tokenUsage?.last);
  if(!total||!last||!params.threadId||!params.turnId)return false;
  const run=task.modelRuns?.findLast(r=>r.threadId===params.threadId&&r.turnId===params.turnId);
  if(!run)return false;
  let turn=null;
  if(run.usageBaseline&&fields.every(k=>total[k]===null||run.usageBaseline[k]===null||total[k]>=run.usageBaseline[k])){
    turn=Object.fromEntries(fields.map(k=>[k,total[k]===null||run.usageBaseline[k]===null?null:total[k]-run.usageBaseline[k]]));
  }
  run.tokenUsage={last,total,turn,source:'official',updatedAt:new Date().toISOString()};
  task.codexTokenTotals||={};
  if(!task.codexTokenTotals[params.threadId]||total.totalTokens>=task.codexTokenTotals[params.threadId].totalTokens)task.codexTokenTotals[params.threadId]=total;
  return true;
}
