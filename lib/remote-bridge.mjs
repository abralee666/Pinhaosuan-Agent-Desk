import {randomBytes} from 'node:crypto';
export class RemoteBridge {
  constructor({membership,devices,rpc,onChange=()=>{},test=false}){Object.assign(this,{membership,devices,rpc,onChange,test});this.config=null;this.controller=null;this.online=false;this.error=null;this.generation=0;this.inflight=new Set();}
  status(){return {enabled:!!this.controller,online:this.online,url:this.config?`${this.config.url}/d/${this.membership.state.membership.installationId}/mobile`:null,error:this.error};}
  async start(config){
    this.membership.assertRemote();const url=new URL(config.url);
    if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||!(url.protocol==='https:'||this.test&&url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)))throw new Error('请填写公网 HTTPS 中继根地址');
    this.stop();const generation=++this.generation;this.config={url:url.origin,secret:config.secret||randomBytes(32).toString('hex')};
    await this.devices.enable();this.controller=new AbortController();
    try{await this.call('/control/register',{license:this.membership.state.membership.license,...(this.membership.edition==='opensource'?{registrationKey:config.registrationKey||process.env.AGENT_DESK_RELAY_REGISTRATION_KEY}: {})});this.online=true;this.error=null;void this.loop(generation);this.onChange();return this.status();}
    catch(error){this.stop();this.error=error.message;throw error;}
  }
  async call(route,body){
    const response=await fetch(this.config.url+route,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${this.config.secret}`,'X-Desktop-Id':this.membership.state.membership.installationId},body:JSON.stringify(body||{}),signal:AbortSignal.any([this.controller.signal,AbortSignal.timeout(25000)])});
    const result=await response.json();if(!response.ok)throw Object.assign(new Error(result.error||'中继连接失败'),{statusCode:response.status});return result;
  }
  async loop(generation){
    while(this.controller&&!this.controller.signal.aborted&&generation===this.generation){
      try{
        if(this.inflight.size>=16){await Promise.race(this.inflight);continue;}
        this.membership.assertRemote();const result=await this.call('/control/poll');if(generation!==this.generation)return;this.online=true;this.error=null;
        for(const job of result.jobs||[]){
          const work=(async()=>{
          let reply;try{this.membership.assertRemote();reply=await this.rpc(job);}catch(error){reply={status:error.statusCode||400,body:{error:error.message}};}
          if(generation!==this.generation)return;
          try{await this.call('/control/reply',{id:job.id,reply});}catch(error){if(generation===this.generation){this.error=error.message;this.onChange();}}
          })();this.inflight.add(work);void work.finally(()=>this.inflight.delete(work));
        }
      }catch(error){
        if(generation!==this.generation||!this.controller||this.controller.signal.aborted)return;
        this.online=false;this.error=error.message;this.onChange();
        if(error.statusCode===403){this.stop();return;}
        await new Promise(resolve=>{const timer=setTimeout(resolve,3000);this.controller?.signal.addEventListener('abort',()=>{clearTimeout(timer);resolve();},{once:true});});
      }
    }
  }
  stop(){this.generation++;this.controller?.abort();this.controller=null;this.online=false;this.onChange();}
}
