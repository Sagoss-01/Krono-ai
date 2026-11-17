import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const outdir = path.resolve('public/vendor');
fs.mkdirSync(outdir, { recursive: true });

const shared = {
  entryPoints: ['src/browser/mediasoup-client-entry.js'],
  bundle: true,
  platform: 'browser',
  target: ['chrome109', 'firefox115', 'safari16'],
  sourcemap: false,
  minify: true,
  logLevel: 'info'
};

await build({
  ...shared,
  format: 'esm',
  outfile: path.join(outdir, 'mediasoup-client.bundle.mjs')
});

await build({
  ...shared,
  format: 'iife',
  globalName: 'TechSphereMediasoupClientGlobal',
  outfile: path.join(outdir, 'mediasoup-client.bundle.js')
});
