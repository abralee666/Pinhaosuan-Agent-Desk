// Accept the file reference forms produced by both supported agents.
export function deliveryReference(value) {
  let name=String(value||'').trim();
  if(name.startsWith('<')&&name.endsWith('>'))name=name.slice(1,-1);
  if(/^file:/i.test(name)){
    try{const url=new URL(name);if(url.hostname&&!/^localhost$/i.test(url.hostname))return null;name=url.pathname;}catch{return null;}
  }else{
    name=name.replace(/^sandbox:/i,'');
    if(/^[a-z][a-z\d+.-]*:/i.test(name)&&!/^\/?[a-z]:[/\\]/i.test(name))return null;
  }
  try{name=decodeURIComponent(name);}catch{return null;}
  name=name.replaceAll('\\','/').replace(/^\/([a-z]:\/)/i,'$1');
  return name.replace(/^\.\//,'');
}
// Parse balanced parentheses and angle-wrapped targets (Chinese filenames may contain either).
export function* deliveryLinks(text) {
 const start=/\[([^\]\n]+)\]\(/g;
 let match;
 while((match=start.exec(text))){
  const from=start.lastIndex;let end=from,target;
  if(text[from]==='<'){
   const close=text.indexOf('>',from+1);
   if(close<0||text[close+1]!==')')continue;
   end=close+1;target=text.slice(from+1,close);
  }else{
   let depth=1;
   for(;end<text.length;end++){
    if(text[end]==='\n')break;
    if(text[end]==='(')depth++;
    if(text[end]===')'&&!--depth)break;
   }
   if(text[end]!==')')continue;
   target=text.slice(from,end);
  }
  yield {index:match.index,raw:text.slice(match.index,end+1),label:match[1],target};start.lastIndex=end+1;
 }
}
