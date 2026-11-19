import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

// Dev-only endpoint: POST /__shot?name=foo with a PNG data URL body saves into screenshots/.
export default defineConfig({
  base: './',
  server: { port: 5173 },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  plugins: [
    {
      name: 'sd-screenshot-endpoint',
      configureServer(server) {
        server.middlewares.use('/__shot', (req, res) => {
          const url = new URL(req.url ?? '', 'http://x');
          const name = (url.searchParams.get('name') ?? 'shot').replace(/[^a-z0-9_-]/gi, '_');
          let body = '';
          req.on('data', (c) => (body += c));
          req.on('end', () => {
            const b64 = body.replace(/^data:image\/png;base64,/, '');
            const out = path.resolve('screenshots', name + '.png');
            fs.mkdirSync(path.dirname(out), { recursive: true });
            fs.writeFileSync(out, Buffer.from(b64, 'base64'));
            res.end('ok ' + out);
          });
        });
      },
    },
  ],
});
