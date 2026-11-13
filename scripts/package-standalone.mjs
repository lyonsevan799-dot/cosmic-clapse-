import { build } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Temporary client entry; the deployed TanStack application is unchanged.
const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(process.argv[2] || '/tmp/cosmic-collapse-crazygames/dist');
if (!output.startsWith('/tmp/')) throw new Error('Export staging must be under /tmp');
await mkdir(resolve(project, '.standalone-export'), { recursive: true });
const entry = await mkdtemp(resolve(project, '.standalone-export/build-'));
try {
  await writeFile(resolve(entry, 'index.html'), `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="description" content="Absorb cosmic objects, outgrow rival black holes, and unleash Mass Surge in Cosmic Collapse."><link rel="icon" href="data:,"><title>Cosmic Collapse — Black Hole Arena</title></head><body><div id="root"></div><script type="module" src="./main.tsx"></script></body></html>`);
  await writeFile(resolve(entry, 'main.tsx'), `import { createRoot } from 'react-dom/client';
import '@fontsource/sora/latin-400.css';
import '@fontsource/sora/latin-600.css';
import '@fontsource/sora/latin-700.css';
import '@fontsource/unbounded/latin-600.css';
import '@fontsource/unbounded/latin-800.css';
import '@/styles.css';
import CosmicCollapse from '@/components/CosmicCollapse';
const root = document.getElementById('root');
if (root) createRoot(root).render(<CosmicCollapse />);`);
  await build({
    configFile: false, root: entry, base: './', publicDir: false,
    plugins: [react(), tailwindcss()],
    resolve: { alias: { '@': resolve(project, 'src') } },
    build: { outDir: output, emptyOutDir: true, sourcemap: false },
  });
} finally {
  await rm(entry, { recursive: true, force: true });
  await rm(resolve(project, '.standalone-export'), { recursive: true, force: true });
}