// Local preview server for the tracker. Dev only: `node tracker/dev/serve.js`
// then open http://localhost:8099. Serves the tracker folder as GitHub Pages would.
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const TYPES = {'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.svg':'image/svg+xml','.css':'text/css','.png':'image/png'};
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, {'Content-Type': TYPES[path.extname(f)] || 'text/plain', 'Cache-Control': 'no-store'});
  fs.createReadStream(f).pipe(res);
}).listen(8099, () => console.log('tracker on http://localhost:8099'));
