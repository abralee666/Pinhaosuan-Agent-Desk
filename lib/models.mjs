import { execFile } from 'node:child_process';
import {antigravityEnvironment} from './agent-env.mjs';

export const effortLabels = { none:'关闭', minimal:'极低', low:'低', medium:'中', high:'高', xhigh:'更高', max:'最高', ultra:'Ultra' };
export function codexCatalog(rows) {
  return rows.filter(m => !m.hidden).map(m => ({ id:m.model, name:m.displayName || m.model,
    efforts:m.supportedReasoningEfforts.map(e => e.reasoningEffort), defaultEffort:m.defaultReasoningEffort,
    isDefault:m.isDefault, description:m.description, mechanism:'parameter',serviceTiers:(m.serviceTiers||m.additionalSpeedTiers||[]).map(t=>typeof t==='string'?t:t.id) }));
}
export function antigravityCatalog(text) {
  const models = new Map();
  for (const line of text.split(/\r?\n/)) {
    const [id,name] = line.split('\t').map(s => s.trim());
    if (!id || !name || !/^[a-zA-Z0-9_.-]+$/.test(id)) continue;
    const variant = id.startsWith('gemini-') && id.match(/^(.*)-(low|medium|high)$/);
    const key = variant ? variant[1] : id;
    if (!models.has(key)) models.set(key, { id:key, name:variant ? name.replace(/\s*\((Low|Medium|High)\)$/i,'') : name,
      efforts:[],
      defaultEffort:variant ? variant[2] : '', variants:{}, mechanism:variant ? 'variant' : 'parameter',
      description:variant ? '低／中／高使用对应的官方模型变体' : '当前 CLI 未提供该模型可用的独立推理强度，使用模型内置设置' });
    const model=models.get(key);
    if (variant) { model.efforts.push(variant[2]); model.variants[variant[2]]=id; }
  }
  return [...models.values()].map(m=>({...m,efforts:['low','medium','high','xhigh','max'].filter(e=>m.efforts.includes(e)),
    defaultEffort:m.efforts.includes('medium')?'medium':m.defaultEffort}));
}
export function listAntigravityModels(command, cwd) {
  const query = () => new Promise((resolve,reject)=>execFile(command,['models'],{cwd,env:antigravityEnvironment(),windowsHide:true,encoding:'utf8',timeout:45000,maxBuffer:256000},(error,stdout)=>{
    if(error)return reject(new Error('Antigravity 模型列表读取失败，请重试连接'));
    const models=antigravityCatalog(stdout);
    if(!models.length)return reject(new Error('官方 CLI 未返回可识别的模型目录'));
    resolve(models);
  }));
  return query().catch(() => new Promise(r => setTimeout(r, 1500)).then(query));
}
export function selectBestModel(catalog) {
  if (!catalog || !catalog.length) return null;
  const score = (m) => {
    const id = (m.id || '').toLowerCase();
    const name = (m.name || '').toLowerCase();
    if (m.isDefault) return 1000;
    if (id.includes('o3') || name.includes('o3')) return 900;
    if (id.includes('o1') || name.includes('o1')) return 800;
    if (id.includes('gpt-5') || id.includes('sol')) return 700;
    if (id.includes('gpt-4o') || id.includes('gpt-4.1')) return 600;
    if (id.includes('claude-3-7') || id.includes('claude-sonnet-4')) return 650;
    if (id.includes('claude-3-5') || id.includes('claude-3.5')) return 600;
    if (id.includes('gemini') && (id.includes('pro') || id.includes('ultra'))) return 550;
    if (id.includes('gemini') && id.includes('flash')) return 400;
    if (id.includes('mini') || id.includes('nano')) return 200;
    return 300;
  };
  return [...catalog].sort((a, b) => score(b) - score(a))[0] || catalog[0];
}

export function resolveSelection(catalog, selection={}, {fallback=false}={}) {
  if(!catalog || !catalog.length) {
    if(!selection.model){if(selection.effort)throw new Error('请先选择模型');return {model:null,effort:null,resolvedModel:null};}
    throw new Error('当前官方模型目录为空，请刷新模型列表');
  }
  if(!selection.model){if(selection.effort)throw new Error('请先选择模型');return {model:null,effort:null,resolvedModel:null};}
  let model=catalog.find(m=>m.id===selection.model);
  let fellBack = false;
  if(!model) {
    if (!fallback) throw new Error('所选模型不在当前官方目录中，请刷新模型列表');
    model = selectBestModel(catalog);
    fellBack = true;
  }
  if(!model) throw new Error('当前官方模型目录为空，请刷新模型列表');

  let serviceTier = selection.serviceTier;
  const fastTier = model.serviceTiers?.find(t=>t==='fast') || model.serviceTiers?.find(t=>t==='priority');
  if(serviceTier !== undefined) {
    if(!['default','fast'].includes(serviceTier))throw Error('无效的速度模式');
    if(serviceTier==='fast'&&!fastTier) {
      if (fellBack) {
        serviceTier = 'default';
      } else {
        throw Error('当前平台或模型未提供 Fast 模式，请刷新模型列表');
      }
    }
  }

  let effort = selection.effort || model.defaultEffort || null;
  if(effort && !model.efforts.includes(effort)) {
    if (fellBack) {
      effort = model.defaultEffort || (model.efforts.length ? model.efforts[model.efforts.length - 1] : null);
    } else {
      throw new Error('所选模型不支持该推理强度');
    }
  }

  return {model:model.id,originalModel:fellBack?selection.model:model.id,fellBack,effort,
    resolvedModel:model.mechanism==='variant'?model.variants[effort]:model.id,
    cliEffort:model.mechanism==='variant'?null:effort,
    ...(serviceTier!==undefined?{serviceTier,...(serviceTier==='fast'?{fastTier}:{})}:{})};
}
export function codexTurnOptions(settings) { return {...(settings.model?{model:settings.resolvedModel,effort:settings.effort}:{}),...(settings.serviceTier!==undefined?{serviceTier:settings.serviceTier==='fast'?(settings.fastTier||'fast'):null}:{})}; }
export function antigravityModelArgs(settings={}) {
  return [...(settings.resolvedModel?['--model',settings.resolvedModel]:[]),...(settings.cliEffort?['--effort',settings.cliEffort]:[])];
}
