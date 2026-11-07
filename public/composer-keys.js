export function bindComposerKeys(input,form,send,canSend){
 let composing=false;
 input.addEventListener('compositionstart',()=>{composing=true;});
 input.addEventListener('compositionend',()=>{composing=false;});
 input.addEventListener('keydown',event=>{
  if(event.key!=='Enter'||event.shiftKey||event.isComposing||composing||event.keyCode===229)return;
  event.preventDefault();
  if(event.repeat||event.ctrlKey||event.altKey||event.metaKey||send.disabled||!canSend())return;
  form.requestSubmit(send);
 });
}
