import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
  chmod,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
const run = promisify(execFile);

void test('verified deploy passes only the runtime binding through stdin and fails before deploy without a key', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jp-deploy-fixture-'));
  try {
    const bin = join(directory, 'bin');
    await mkdir(bin);
    const evidence = join(directory, 'received.json');
    const executable = join(bin, 'pnpm');
    await writeFile(
      executable,
      `#!/usr/bin/env node
const fs=require('node:fs');
let data='';process.stdin.on('data',part=>data+=part);process.stdin.on('end',()=>{fs.writeFileSync(process.env.FIXTURE_EVIDENCE,JSON.stringify({args:process.argv.slice(2),binding:JSON.parse(data),keyInEnvironment:Boolean(process.env.OPENAI_API_KEY)}));});
`,
    );
    await chmod(executable, 0o700);
    const env = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH || ''}`,
      FIXTURE_EVIDENCE: evidence,
      OPENAI_API_KEY: 'synthetic-secret-fixture',
    };
    const result = await run(
      process.execPath,
      [resolve('scripts/deploy-verified.mjs')],
      { env },
    );
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
    const received: unknown = JSON.parse(await readFile(evidence, 'utf8'));
    assert.deepEqual(received, {
      args: ['exec', 'wrangler', 'deploy', '--secrets-file', '/dev/stdin'],
      binding: { OPENAI_API_KEY: 'synthetic-secret-fixture' },
      keyInEnvironment: false,
    });
    await rm(evidence);
    await assert.rejects(
      run(process.execPath, [resolve('scripts/deploy-verified.mjs')], {
        env: { ...env, OPENAI_API_KEY: '' },
      }),
      /OPENAI_API_KEY GitHub Actions secret is required/,
    );
    await assert.rejects(readFile(evidence), /ENOENT/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
