// Serves the exported website (dist/) the way Cloudflare Pages does, for the
// accessibility checks: /privacy → privacy.html, /invite/<token> → the one
// pre-built invite page, unknown paths → the 404 page with status 404.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const root = process.argv[2] ?? 'dist';
const port = Number(process.argv[3] ?? 4321);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.webmanifest': 'application/manifest+json' };

function resolve(pathname) {
  const clean = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  const candidates = [clean, `${clean}.html`, join(clean, 'index.html')];
  if (/^\/invite\/[^/]+$/.test(clean)) candidates.push('/invite/[token].html');
  for (const c of candidates) {
    const file = join(root, c);
    if (existsSync(file) && statSync(file).isFile()) return { file, status: 200 };
  }
  return { file: join(root, '+not-found.html'), status: 404 };
}

createServer((req, res) => {
  const { file, status } = resolve(new URL(req.url ?? '/', 'http://x').pathname);
  res.writeHead(status, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
}).listen(port, () => console.log(`serving ${root} on http://localhost:${port}`));
