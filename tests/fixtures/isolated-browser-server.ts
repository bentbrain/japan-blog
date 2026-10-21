import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

type Command = { file: string; args: string[] };
type Options = {
  temporaryDirectory?: string;
  inputs?: string[];
  copyInput?: (source: string, destination: string) => Promise<void>;
  installCommand?: Command;
  serverCommand?: Command;
  healthCheck?: (baseURL: string, signal: AbortSignal) => Promise<boolean>;
  startupTimeoutMs?: number;
  installTimeoutMs?: number;
  terminationGraceMs?: number;
  killTimeoutMs?: number;
};

function groupExists(pid: number) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH')
      return false;
    if (error instanceof Error && 'code' in error && error.code === 'EPERM')
      return true;
    throw error;
  }
}

function signalGroup(pid: number, signal: NodeJS.Signals) {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH'))
      throw error;
  }
}

async function waitForGroup(pid: number, timeoutMs: number) {
  const deadline = performance.now() + timeoutMs;
  while (groupExists(pid)) {
    if (performance.now() >= deadline) return false;
    await delay(20);
  }
  return true;
}

async function interruptible<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  signal.throwIfAborted();
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        abort = () => {
          reject(
            signal.reason instanceof Error
              ? signal.reason
              : new Error('Fixture stopped'),
          );
        };
        signal.addEventListener('abort', abort, { once: true });
      }),
    ]);
  } finally {
    if (abort) signal.removeEventListener('abort', abort);
  }
}

// The owner receives stop synchronously, even while copies/install/health are pending.
// Commands and deadlines are injectable so lifecycle tests use real disposable children.
export function startIsolatedBrowserServer(
  logPath: string,
  options: Options = {},
) {
  const source = fileURLToPath(new URL('../..', import.meta.url));
  const controller = new AbortController();
  const { signal } = controller;
  const root = mkdtemp(
    join(options.temporaryDirectory ?? tmpdir(), 'japan-grid-runtime-'),
  );
  let copies: Promise<void>[] = [];
  const children: { pid: number; closed: Promise<void> }[] = [];
  let log = '';
  const record = (text: string) => {
    log = (log + text).slice(-200_000);
  };
  const timer = setTimeout(() => {
    controller.abort(new Error('Fixture startup timed out'));
  }, options.startupTimeoutMs ?? 110_000);
  const env = {
    ...process.env,
    TEST_EPHEMERAL: '1',
    PUBLIC_FEEDBACK_SERVER: 'https://toolbar.bent.build',
    PUBLIC_FEEDBACK_PROJECT_ID: 'prj_0000000000000000',
  };

  function launch(command: Command, directory: string) {
    signal.throwIfAborted();
    const child = spawn(command.file, command.args, {
      cwd: directory,
      env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk: Buffer) => {
      record(chunk.toString());
    });
    child.stderr.on('data', (chunk: Buffer) => {
      record(chunk.toString());
    });
    child.on('error', (error) => {
      record(`${error.message}\n`);
    });
    const closed = new Promise<void>((resolve) => {
      child.once('close', () => {
        resolve();
      });
    });
    // Register ownership before any await. Both installation and Astro own groups.
    if (child.pid) children.push({ pid: child.pid, closed });
    const exited = new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, termination) => {
        if (code === 0) resolve();
        else
          reject(
            new Error(`Fixture command failed: ${String(code ?? termination)}`),
          );
      });
    });
    // A server can exit before the health loop observes it.
    void exited.catch(() => {});
    return exited;
  }

  async function setup() {
    const directory = await root;
    signal.throwIfAborted();
    record(
      JSON.stringify({
        runtimeRoot: directory,
        astroCache: join(directory, '.astro'),
        viteCache: join(directory, '.vite'),
        ephemeralD1: true,
        copiedInputsOnly: true,
        dependencies: 'offline frozen install inside runtime root',
      }) + '\n',
    );
    const copy =
      options.copyInput ??
      (async (from: string, to: string) => {
        await cp(from, to, { recursive: true });
      });
    copies = (
      options.inputs ?? [
        'src',
        'public',
        'scripts',
        'seed',
        'migrations',
        'astro.config.mjs',
        'tsconfig.json',
        'wrangler.jsonc',
        'package.json',
        'pnpm-lock.yaml',
        'pnpm-workspace.yaml',
      ]
    ).map((path) => copy(join(source, path), join(directory, path)));
    await interruptible(Promise.all(copies), signal);
    // Astro virtual component IDs must resolve inside this runtime's root.
    const installing = launch(
      options.installCommand ?? {
        file: 'pnpm',
        args: [
          'install',
          '--offline',
          '--frozen-lockfile',
          '--reporter=append-only',
        ],
      },
      directory,
    );
    const installTimer = setTimeout(() => {
      controller.abort(new Error('Fixture dependency installation timed out'));
    }, options.installTimeoutMs ?? 90_000);
    try {
      await interruptible(installing, signal);
    } finally {
      clearTimeout(installTimer);
    }
    signal.throwIfAborted();
    await writeFile(
      join(directory, 'grid.config.mjs'),
      `
import base from './astro.config.mjs';
export default {
  ...base,
  cacheDir: ${JSON.stringify(join(directory, '.astro'))},
  vite: { ...base.vite, cacheDir: ${JSON.stringify(join(directory, '.vite'))} },
};
`,
    );
    signal.throwIfAborted();
    const reservation = createServer();
    let port: string;
    try {
      const listening = once(reservation, 'listening');
      reservation.listen(0, '127.0.0.1');
      await interruptible(listening, signal);
      const address = reservation.address();
      if (!address || typeof address === 'string')
        throw new Error('Fixture port required');
      port = String(address.port);
    } finally {
      await new Promise<void>((resolve, reject) => {
        reservation.close((error) => {
          if (
            error &&
            !('code' in error && error.code === 'ERR_SERVER_NOT_RUNNING')
          )
            reject(error);
          else resolve();
        });
      });
    }
    const baseURL = `http://127.0.0.1:${port}`;
    const serving = launch(
      options.serverCommand ?? {
        file: process.execPath,
        args: [
          join(directory, 'node_modules/astro/bin/astro.mjs'),
          'dev',
          '--config',
          'grid.config.mjs',
          '--host',
          '127.0.0.1',
          '--port',
          port,
          '--ignore-lock',
        ],
      },
      directory,
    );
    const healthCheck =
      options.healthCheck ??
      (async (url: string, abort: AbortSignal) => {
        try {
          const response = await fetch(`${url}/_emdash/api/health`, {
            signal: AbortSignal.any([abort, AbortSignal.timeout(2_000)]),
          });
          await response.body?.cancel();
          return response.ok;
        } catch {
          abort.throwIfAborted();
          return false;
        }
      });
    const serverFailure = serving.then(() => {
      throw new Error('Fixture server exited before health');
    });
    while (
      !(await interruptible(
        Promise.race([healthCheck(baseURL, signal), serverFailure]),
        signal,
      ))
    ) {
      await delay(100, undefined, { signal });
    }
    signal.throwIfAborted();
    clearTimeout(timer);
    return { baseURL };
  }

  const startup = setup();
  let stopping: Promise<void> | undefined;
  function stop() {
    stopping ??= (async () => {
      controller.abort(new Error('Fixture stopped'));
      clearTimeout(timer);
      // Startup observes cancellation before creating any further children.
      await startup.catch(() => {});
      const directory = await root.catch(() => undefined);
      try {
        const stopped = await Promise.allSettled(
          children.map(async ({ pid, closed }) => {
            if (groupExists(pid)) signalGroup(pid, 'SIGTERM');
            if (
              !(await waitForGroup(pid, options.terminationGraceMs ?? 5_000))
            ) {
              signalGroup(pid, 'SIGKILL');
            }
            if (!(await waitForGroup(pid, options.killTimeoutMs ?? 5_000))) {
              throw new Error(
                'Owned fixture process group survived SIGKILL; runtime root retained',
              );
            }
            await interruptible(
              closed,
              AbortSignal.timeout(options.killTimeoutMs ?? 5_000),
            );
          }),
        );
        // cp cannot be cancelled. A failed sibling must finish before root deletion.
        await Promise.allSettled(copies);
        const failures = stopped.filter(
          (result) => result.status === 'rejected',
        );
        if (failures.length)
          throw new AggregateError(
            failures.map((result) => {
              const reason: unknown = result.reason;
              return reason;
            }),
            'Fixture cleanup failed; runtime root retained',
          );
      } finally {
        await mkdir(dirname(logPath), { recursive: true });
        await writeFile(logPath, log);
      }
      if (directory) await rm(directory, { recursive: true, force: true });
    })();
    return stopping;
  }
  const ready = startup.catch(async (error: unknown) => {
    record(
      `${error instanceof Error ? error.message : 'Fixture setup failed'}\n`,
    );
    await stop();
    throw error;
  });
  // The owner may call stop without first consuming ready.
  void ready.catch(() => {});
  return { ready, stop };
}
