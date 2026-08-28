// Execute after compiling both packages so this verifies Node runtime resolution, not TypeScript source resolution.
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const packageRoot = new URL('./', import.meta.url);
const compiledWorkerUrl = new URL('./dist/index.js', packageRoot);
const compiledWorker = await readFile(compiledWorkerUrl, 'utf8');

if (compiledWorker.includes('packages/ai/src') || compiledWorker.includes('.ts')) {
  throw new Error('Compiled worker must not depend on @fitcoach/ai TypeScript source paths');
}

function runModuleProbe(source) {
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
    cwd: packageRoot,
    encoding: 'utf8',
    stdio: 'pipe',
  });

  if (result.status !== 0) {
    throw new Error('Runtime package probe failed');
  }
}

runModuleProbe(`
  const ai = await import('@fitcoach/ai');
  if (typeof ai.createAIRouter !== 'function') {
    throw new Error('createAIRouter is not exported from @fitcoach/ai');
  }
`);

runModuleProbe(`
  const worker = await import('./dist/index.js');
  if (typeof worker.createAIWorker !== 'function') {
    throw new Error('createAIWorker is not available from compiled worker output');
  }
`);
