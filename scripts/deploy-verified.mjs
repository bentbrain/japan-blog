import { spawn } from 'node:child_process';

// Called only by Deploy, after require-checks verifies the checked-out SHA.
// /dev/stdin is read once by Wrangler's secrets-file parser. The key never
// enters command arguments, the repository, a temporary file, or stdout.
const key = process.env.OPENAI_API_KEY?.trim();
if (!key) throw new Error('OPENAI_API_KEY GitHub Actions secret is required');
const child = spawn(
  'pnpm',
  ['exec', 'wrangler', 'deploy', '--secrets-file', '/dev/stdin'],
  {
    stdio: ['pipe', 'inherit', 'inherit'],
    env: { ...process.env, OPENAI_API_KEY: undefined },
  },
);
child.stdin.on('error', () => {});
child.stdin.end(JSON.stringify({ OPENAI_API_KEY: key }));
child.on('error', () => {
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
