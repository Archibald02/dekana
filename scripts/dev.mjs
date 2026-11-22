import './build.mjs';
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { Readable } from 'node:stream';
import { localDB } from './local-db.mjs';

const { default: worker } = await import('../dist/server/index.js');
mkdirSync('.data', {recursive:true});
const publicOrigin = process.env.PUBLIC_ORIGIN;
const env = {DB: localDB('.data/dekana.sqlite'), LOCAL_HTTP: publicOrigin?.startsWith('https:') ? undefined : '1'};
const argument = process.argv.indexOf('--port');
const port = Number(process.env.PORT || (argument >= 0 && process.argv[argument + 1]) || 3000);
createServer(async (incoming, outgoing) => {
  try {
    const method = incoming.method;
    const init = { method, headers: incoming.headers };
    if (method !== 'GET' && method !== 'HEAD') {
      init.body = Readable.toWeb(incoming);
      init.duplex = 'half';
    }
    const result = await worker.fetch(new Request((publicOrigin || 'http://' + incoming.headers.host) + incoming.url, init), env);
    outgoing.writeHead(result.status, Object.fromEntries(result.headers));
    if (result.body) Readable.fromWeb(result.body).pipe(outgoing);
    else outgoing.end();
  } catch {
    outgoing.writeHead(500).end('Internal server error');
  }
}).listen(port,'0.0.0.0',()=>console.log('Local: http://localhost:' + port));
