import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const port = Number(process.env.PORT || 4173);
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.wasm':'application/wasm', '.svg':'image/svg+xml', '.woff2':'font/woff2', '.json':'application/json' };
if (!existsSync(resolve(root,'index.html'))) {
  console.error('The production build is missing. Run npm ci and npm run build first.');
  process.exit(1);
}
const server = createServer((request,response)=>{
  if(request.method!=='GET' && request.method!=='HEAD') { response.writeHead(405);response.end();return; }
  let filename;
  try {
    const path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    filename = resolve(root, '.' + (path==='/'?'/index.html':path));
    if(!filename.startsWith(root + sep) || !existsSync(filename) || !statSync(filename).isFile()) {
      response.writeHead(404); response.end('Not found'); return;
    }
  } catch { response.writeHead(400);response.end('Bad request');return; }
  response.writeHead(200, { 'Content-Type':types[extname(filename)] ?? 'application/octet-stream', 'Cache-Control':'no-cache', 'X-Content-Type-Options':'nosniff' });
  if(request.method==='HEAD') response.end(); else createReadStream(filename).pipe(response);
});
server.on('error',error=>{console.error(error.code==='EADDRINUSE'?`Port ${port} is already in use. Konverson may already be running at http://127.0.0.1:${port}/`:error.message);process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>{
  console.log(`\nKonverson is ready: http://127.0.0.1:${port}/\nKeep this window open while playing. Press Ctrl+C to stop.\n`);
});
