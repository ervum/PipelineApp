import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const prismaDir = path.join(rootDir, 'backend', 'prisma');
const schemaPath = path.join(prismaDir, 'schema.prisma');

console.log('[db-watch] Starting Docker Postgres container...');
spawnSync('docker', ['compose', 'up', '-d', 'postgres'], {
  cwd: rootDir,
  stdio: 'inherit',
  shell: true,
});

console.log('[db-watch] Syncing Prisma schema with Postgres database...');
spawnSync('npx', ['prisma', 'db', 'push', '--schema=backend/prisma/schema.prisma'], {
  cwd: rootDir,
  stdio: 'inherit',
  shell: true,
});

let debounceTimer = null;
let isSyncingPrisma = false;

function syncPrismaSchema() {
  if (isSyncingPrisma) return;
  isSyncingPrisma = true;
  console.log('\n[db-watch] Detected change in prisma/schema.prisma -> regenerating Prisma Client & pushing schema...');
  const gen = spawnSync('npx', ['prisma', 'generate', '--schema=backend/prisma/schema.prisma'], {
    cwd: rootDir,
    stdio: 'inherit',
    shell: true,
  });
  if (gen.status === 0) {
    spawnSync('npx', ['prisma', 'db', 'push', '--schema=backend/prisma/schema.prisma'], {
      cwd: rootDir,
      stdio: 'inherit',
      shell: true,
    });
    console.log('[db-watch] Prisma schema & client updated. Watching for further changes...');
  }
  isSyncingPrisma = false;
}

if (fs.existsSync(prismaDir)) {
  console.log(`[db-watch] Watching ${path.relative(rootDir, schemaPath)} for schema changes...`);
  fs.watch(prismaDir, { persistent: true }, (_eventType, filename) => {
    if (!filename || !filename.endsWith('.prisma')) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      syncPrismaSchema();
    }, 350);
  });
}

console.log('[db-watch] Streaming Docker Postgres logs (Ctrl+C to stop)...');
const logStream = spawn('docker', ['compose', 'logs', '-f', '--tail=50', 'postgres'], {
  cwd: rootDir,
  stdio: 'inherit',
  shell: true,
});

function shutdown() {
  if (debounceTimer) clearTimeout(debounceTimer);
  logStream.kill();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
