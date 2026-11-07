import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export function distributionEdition({root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),env=process.env}={}){
  const config=path.join(root,'distribution.json');
  const edition=env.AGENT_DESK_EDITION||(fs.existsSync(config)?JSON.parse(fs.readFileSync(config,'utf8')).edition:'commercial');
  if(!['opensource','commercial'].includes(edition))throw Error('无效的发行版本');
  return edition;
}
