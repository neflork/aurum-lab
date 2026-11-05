import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const port = Number(process.env.AURUM_AI_PORT ?? 8787);
const children = new Set();
let stopping = false;
let exitCode = 0;

function signalChild(child, signal) {
  try {
    if (process.platform === 'win32') child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') console.error(error.message);
  }
}

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  exitCode = code;
  for (const child of children) signalChild(child, 'SIGTERM');
  if (!children.size) process.exit(exitCode);
  setTimeout(() => {
    for (const child of children) signalChild(child, 'SIGKILL');
  }, 5000).unref();
}

function launch(args) {
  const child = spawn(process.execPath, args, {
    stdio: 'inherit',
    detached: process.platform !== 'win32',
  });
  children.add(child);
  child.once('error', (error) => {
    console.error(error.message);
    children.delete(child);
    stop(1);
  });
  child.once('exit', (code, signal) => {
    children.delete(child);
    if (!stopping) stop(code ?? (signal ? 1 : 0));
    if (!children.size) process.exit(exitCode);
  });
}

process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());

try {
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('AURUM_AI_PORT должен быть числом от 1 до 65535.');
  const databasePort = Number(process.env.AURUM_DB_PORT ?? 8788);
  if (
    !Number.isInteger(databasePort) ||
    databasePort < 1 ||
    databasePort > 65535 ||
    databasePort === port
  )
    throw new Error(
      'AURUM_DB_PORT должен быть отдельным портом от 1 до 65535.',
    );
  let databaseHealth = null;
  try {
    databaseHealth = await fetch(`http://127.0.0.1:${databasePort}/health`, {
      signal: AbortSignal.timeout(1500),
    });
  } catch (error) {
    if (error.cause?.code !== 'ECONNREFUSED') throw error;
  }
  if (databaseHealth) {
    const health = databaseHealth.ok
      ? await databaseHealth.json().catch(() => null)
      : null;
    if (health?.service !== 'aurum-research-database' || health.schema !== 2)
      throw new Error(`Порт ${databasePort} занят другим сервисом.`);
  } else
    launch([fileURLToPath(new URL('./research-server.mjs', import.meta.url))]);
  let existing = null;
  try {
    existing = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(1500),
    });
  } catch (error) {
    if (error.cause?.code !== 'ECONNREFUSED') throw error;
  }
  if (stopping) process.exit(exitCode);
  if (existing) {
    const health = existing.ok ? await existing.json().catch(() => null) : null;
    if (health?.service !== 'aurum-codex-bridge')
      throw new Error(
        `Порт ${port} занят. Остановите старый помощник или задайте другой AURUM_AI_PORT.`,
      );
    console.log('Локальный помощник уже работает — используем его.');
  } else {
    launch([fileURLToPath(new URL('./codex-ai-bridge.mjs', import.meta.url))]);
  }
  launch([
    fileURLToPath(
      new URL('../node_modules/vinext/dist/cli.js', import.meta.url),
    ),
    'dev',
    ...process.argv.slice(2),
  ]);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  stop(1);
}
