import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bindComposerKeys} from '../public/composer-keys.js';
test('Enter submits once, Shift+Enter preserves newline and IME confirmation never submits',()=>{
 const input=new EventTarget(),send={disabled:false};let count=0,ready=true;
 bindComposerKeys(input,{requestSubmit:button=>{assert.equal(button,send);count++;}},send,()=>ready);
 const enter=options=>{const event=new Event('keydown',{cancelable:true});Object.assign(event,{key:'Enter',...options});input.dispatchEvent(event);return event;};
 assert.equal(enter().defaultPrevented,true);assert.equal(count,1);
 assert.equal(enter({shiftKey:true}).defaultPrevented,false);assert.equal(count,1);
 input.dispatchEvent(new Event('compositionstart'));assert.equal(enter().defaultPrevented,false);input.dispatchEvent(new Event('compositionend'));
 assert.equal(enter({isComposing:true}).defaultPrevented,false);assert.equal(enter({keyCode:229}).defaultPrevented,false);assert.equal(count,1);
 enter({repeat:true});send.disabled=true;enter();send.disabled=false;ready=false;enter();assert.equal(count,1);
 ready=true;enter();assert.equal(count,2);
});
