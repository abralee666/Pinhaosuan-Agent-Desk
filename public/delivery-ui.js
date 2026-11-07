import {deliveryReference,deliveryLinks} from './delivery-path.js';
const escape = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const fileUrl=(taskId,name,action='')=>`/api/task/file?taskId=${encodeURIComponent(taskId)}&path=${encodeURIComponent(name)}${action?'&action='+action:''}`;
const glyphs={
 file:'<path d="M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10z"/><path d="M13 3v7h7M8 14h8M8 17h5"/>',
 presentation:'<circle cx="14" cy="12" r="8"/><path d="M14 4v8h8"/><rect x="2" y="7" width="10" height="12" rx="1.5" fill="var(--glyph-bg,#fff)"/><path d="M5 16v-6h2a1.7 1.7 0 0 1 0 3.4H5"/>',
 pdf:'<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6"/><path d="M7 17c3-2 5-6 5-8-1 1 0 6 5 7-3-2-7-2-10 1Z"/>',
 word:'<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M7 13l1.8 5 2.2-5 2.2 5 1.8-5"/>',
 archive:'<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M9 3v2m0 2v2m0 2v2"/><rect x="7" y="15" width="4" height="3" rx="1"/>',
 slides:'<rect x="3" y="4" width="18" height="14" rx="2"/><path d="M9 22l3-4 3 4M8 13V9m4 4V7m4 6v-3"/>',
 sheet:'<path d="M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10z"/><path d="M13 3v7h7M8 13h8M8 17h8M11 13v4"/>',
 image:'<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/>',
 preview:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 9v11"/>',
 open:'<path d="M14 3h7v7m0-7L10 14M10 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-5"/>',
 download:'<path d="M12 3v12m-4-4 4 4 4-4M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
 folder:'<path d="M3 7V5a2 2 0 0 1 2-2h4l3 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7h18"/>'
};
const icon=kind=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${glyphs[kind]||glyphs.file}</svg>`;
export function fileIcon(name){
 const ext=name.split('.').pop().toLowerCase();
 const kind=/^pptx?$/.test(ext)?'presentation':ext==='pdf'?'pdf':/^docx?$/.test(ext)?'word':ext==='zip'?'archive':/^(xlsx?|csv)$/.test(ext)?'sheet':/^(png|jpe?g|gif|webp|svg)$/.test(ext)?'image':'file';
 const tone=kind==='presentation'||ext==='pdf'?'red':kind==='sheet'?'green':kind==='image'?'purple':kind==='archive'?'amber':/^(docx?|html?|md)$/.test(ext)?'blue':'gray';
 return `<span class="delivery-file-glyph tone-${tone}">${icon(kind)}</span>`;
}
export function formatFileSize(size){return size<1024?`${size} B`:size<1048576?`${(size/1024).toFixed(size<10240?1:0)} KB`:`${(size/1048576).toFixed(1)} MB`;}
export function previewType(name){
  const ext=name.split('.').pop().toLowerCase();
  if(['pdf','png','jpg','jpeg','webp','gif','svg','html','htm'].includes(ext))return 'frame';
  if(['ppt','pptx','doc','docx','xls','xlsx','zip'].includes(ext))return 'external';
  return 'text';
}
function formatInline(str) {
  // Inline code: `code`
  str = str.replace(/`([^`\n]+)`/g, (_, c) => `<code class="inline-code">${c}</code>`);
  // Bold: **text**
  str = str.replace(/\*\*([^\*\n]+)\*\*/g, (_, b) => `<strong>${b}</strong>`);
  // Italic: *text*
  str = str.replace(/(^|[^\*])\*([^\*\n]+)\*([^\*]|$)/g, '$1<em>$2</em>$3');
  return str;
}

export function formatMarkdown(text) {
  if (!text) return '';
  const codeBlocks = [];
  // 1. Extract code blocks first
  let processed = text.replace(/```(?:([a-zA-Z0-9_-]+)\r?\n)?([\s\S]*?)```/g, (_, lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push(`<pre class="chat-code"><code${lang ? ` class="language-${escape(lang)}"` : ''}>${escape(code.trimEnd())}</code></pre>`);
    return `\uFFF1${idx}\uFFF1`;
  });

  // 2. Escape all remaining text before applying inline markdown tags
  processed = escape(processed);

  // 3. Process blocks
  const rawBlocks = processed.split(/\r?\n\r?\n+/);
  const formattedBlocks = rawBlocks.map(block => {
    const trimmed = block.trim();
    if (!trimmed) return '';
    if (/^\uFFF1\d+\uFFF1$/.test(trimmed)) return trimmed;

    // Headings
    if (/^### (.*)$/m.test(trimmed)) {
      return trimmed.replace(/^### (.*)$/gm, (_, h) => `<h3>${formatInline(h)}</h3>`);
    }
    if (/^## (.*)$/m.test(trimmed)) {
      return trimmed.replace(/^## (.*)$/gm, (_, h) => `<h2>${formatInline(h)}</h2>`);
    }
    if (/^# (.*)$/m.test(trimmed)) {
      return trimmed.replace(/^# (.*)$/gm, (_, h) => `<h1>${formatInline(h)}</h1>`);
    }

    const lines = trimmed.split(/\r?\n/);
    const hasList = lines.some(l => /^[\t ]*[-*•] (.*)$/.test(l) || /^[\t ]*\d+\. (.*)$/.test(l));
    if (hasList) {
      let result = '';
      let currentList = null;
      for (const line of lines) {
        const uMatch = line.match(/^[\t ]*[-*•] (.*)$/);
        const oMatch = line.match(/^[\t ]*\d+\. (.*)$/);
        if (uMatch) {
          if (currentList !== 'ul') {
            if (currentList) result += `</${currentList}>`;
            result += '<ul class="chat-list">';
            currentList = 'ul';
          }
          result += `<li>${formatInline(uMatch[1])}</li>`;
        } else if (oMatch) {
          if (currentList !== 'ol') {
            if (currentList) result += `</${currentList}>`;
            result += '<ol class="chat-list">';
            currentList = 'ol';
          }
          result += `<li>${formatInline(oMatch[1])}</li>`;
        } else {
          if (currentList) {
            result += `</${currentList}>`;
            currentList = null;
          }
          if (line.trim()) result += `<p>${formatInline(line)}</p>`;
        }
      }
      if (currentList) result += `</${currentList}>`;
      return result;
    }

    const content = lines.map(l => formatInline(l)).join('<br>');
    return `<p>${content}</p>`;
  });

  let result = formattedBlocks.filter(Boolean).join('');
  result = result.replace(/\uFFF1(\d+)\uFFF1/g, (_, idx) => codeBlocks[Number(idx)] || '');
  return result;
}

export function renderDeliveryMessage(text,task){
  const files=[...(task.deliveryFiles||[]),...(task.fileContents||[])],found=new Map();
  const linkReplacements = [];
  let html='',last=0;
  for(const match of deliveryLinks(String(text))){
    html+=text.slice(last,match.index);last=match.index+match.raw.length;
    let target=deliveryReference(match.target);
    if(target===null){html+=match.raw;continue;}
    const workspace=(task.workspace||'').replaceAll('\\','/').replace(/\/$/,'');
    if(workspace&&target.toLowerCase().startsWith(workspace.toLowerCase()+'/'))target=target.slice(workspace.length+1);
    target=target.replace(/^\.\//,'');
    const file=files.find(f=>/^[a-z]:\//i.test(workspace)?f.name.toLowerCase()===target.toLowerCase():f.name===target);
    if(file){
      found.set(file.name,file);
      const tag = `<a class="delivery-link" href="${fileUrl(task.id,file.name)}" data-delivery-preview="${escape(file.name)}">${fileIcon(file.name)}<span>${escape(match.label)}</span></a>`;
      const placeholder = `\uFFF0${linkReplacements.length}\uFFF0`;
      linkReplacements.push(tag);
      html += placeholder;
    }
    else html+=match.raw;
  }
  html+=text.slice(last);

  let formatted = formatMarkdown(html);
  formatted = formatted.replace(/\uFFF0(\d+)\uFFF0/g, (_, i) => linkReplacements[Number(i)] || '');

  const cards=[...found.values()].map(f=>{
    const ext=f.name.split('.').pop().toUpperCase();
    return `<div class="delivery-card"><a class="delivery-main" href="${fileUrl(task.id,f.name)}" data-delivery-preview="${escape(f.name)}" title="预览 ${escape(f.name)}"><span class="delivery-icon" aria-hidden="true">${fileIcon(f.name)}</span><span class="delivery-info"><strong>${escape(f.name.split('/').pop())}</strong><small>打开预览</small></span></a><details class="delivery-menu" data-delivery-name="${escape(f.name)}"><summary aria-label="${escape(f.name)} 的打开方式">打开方式 <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg></summary><div class="delivery-menu-panel"><button type="button" data-file="${escape(f.name)}">${icon('preview')}<span>应用内预览</span></button><button type="button" data-delivery-open="${escape(f.name)}" data-open-action="open">${icon('open')}<span>系统默认应用打开</span></button><a href="${fileUrl(task.id,f.name,'download')}" download>${icon('download')}<span>下载原文件</span></a><span class="delivery-menu-divider"></span><button type="button" data-delivery-open="${escape(f.name)}" data-open-action="open-folder">${icon('folder')}<span>打开所在文件夹</span></button></div></details></div>`;
  }).join('');
  return `<div class="event-text">${formatted}</div>${cards?`<div class="delivery-cards">${cards}</div>`:''}`;
}

export function bindDeliveryMenus(root){
 let openedName=null;
 const close=()=>{openedName=null;root.querySelectorAll('.delivery-menu[open]').forEach(menu=>menu.open=false);};
 root.addEventListener('toggle',event=>{
  const menu=event.target;
  if(!menu.matches?.('.delivery-menu'))return;
  if(!menu.open){if(openedName===menu.dataset.deliveryName)openedName=null;return;}
  openedName=menu.dataset.deliveryName;
  root.querySelectorAll('.delivery-menu[open]').forEach(other=>{if(other!==menu)other.open=false;});
  const panel=menu.querySelector('.delivery-menu-panel'),anchor=menu.querySelector('summary').getBoundingClientRect();
  panel.style.visibility='hidden';panel.style.position='fixed';
  const height=panel.getBoundingClientRect().height,width=panel.getBoundingClientRect().width;
  panel.style.left=`${Math.max(12,Math.min(anchor.right-width,innerWidth-width-12))}px`;
  panel.style.top=`${Math.max(12,anchor.bottom+height+12<innerHeight?anchor.bottom+8:anchor.top-height-8)}px`;
  panel.style.visibility='visible';
 },true);
 document.addEventListener('click',event=>{if(!event.target.closest('.delivery-menu')||event.target.closest('.delivery-menu-panel button,.delivery-menu-panel a'))close();});
 document.addEventListener('keydown',event=>{if(event.key==='Escape')close();});
 window.addEventListener('resize',close);
 document.addEventListener('wheel',close,{passive:true});
 document.addEventListener('touchmove',close,{passive:true});
 return ()=>{if(openedName)for(const menu of root.querySelectorAll('.delivery-menu'))if(menu.dataset.deliveryName===openedName)menu.open=true;};
}
