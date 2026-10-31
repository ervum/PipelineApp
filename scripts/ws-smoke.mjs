import { io } from 'socket.io-client';

const BASE_URL = (process.env.FORGE_URL || 'http://localhost:3310').replace(
  /\/$/,
  '',
);

async function main() {
  console.log(`[ws-smoke] Connecting to ForgeStudio backend at ${BASE_URL}`);

  const projRes = await fetch(`${BASE_URL}/api/v1/projects`);
  if (!projRes.ok) {
    throw new Error(`GET /api/v1/projects failed: ${projRes.status}`);
  }
  const projects = await projRes.json();
  const astra =
    projects.find((p) => p.slug === 'astra-chronicles') ?? projects[0];
  if (!astra) {
    throw new Error('No seeded projects found');
  }
  console.log(
    `[ws-smoke] Found project: "${astra.name}" (id=${astra.id}, slug=${astra.slug})`,
  );

  const provRes = await fetch(`${BASE_URL}/api/v1/providers`);
  if (!provRes.ok) {
    throw new Error(`GET /api/v1/providers failed: ${provRes.status}`);
  }
  const providers = await provRes.json();
  const demoProvider = providers.find((p) => p.kind === 'DEMO');
  if (!demoProvider) {
    throw new Error('Demo provider not found');
  }
  console.log(
    `[ws-smoke] Found Demo provider: "${demoProvider.name}" (id=${demoProvider.id})`,
  );

  const socket = io(`${BASE_URL}/orchestrator`, {
    transports: ['websocket'],
    forceNew: true,
  });

  await new Promise((resolve, reject) => {
    socket.on('connect', () => resolve());
    socket.on('connect_error', (err) => reject(err));
  });
  console.log(`[ws-smoke] Connected to /orchestrator (socketId=${socket.id})`);

  const subAck = await socket.emitWithAck('studio:subscribe-project', {
    projectId: astra.id,
  });
  console.log(
    `[ws-smoke] studio:subscribe-project ack: ${JSON.stringify(subAck)}`,
  );

  let targetJobId = null;
  let seq = 0;

  const donePromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Timed out waiting for job:completed event'));
    }, 25000);

    socket.on('job:created', (p) => {
      if (!targetJobId || p.job.id === targetJobId) {
        targetJobId = p.job.id;
        console.log(
          `[${++seq}] job:created -> jobId=${p.job.id} modality=${p.job.modality} mode=${p.job.executionMode} status=${p.job.status}`,
        );
      }
    });

    socket.on('job:status', (p) => {
      if (!targetJobId || p.jobId === targetJobId) {
        console.log(
          `[${++seq}] job:status -> ${p.from} -> ${p.to} (${p.message})`,
        );
      }
    });

    socket.on('job:middleman-chunk', (p) => {
      if (!targetJobId || p.jobId === targetJobId) {
        console.log(
          `[${++seq}] job:middleman-chunk -> seq=${p.seq} accumulatedChars=${p.accumulatedChars}`,
        );
      }
    });

    socket.on('job:middleman-complete', (p) => {
      if (!targetJobId || p.jobId === targetJobId) {
        console.log(
          `[${++seq}] job:middleman-complete -> nextStatus=${p.nextStatus} title="${p.compiled.assetTitle}" contextFiles=${p.contextFiles.length}`,
        );
      }
    });

    socket.on('job:worker-status', (p) => {
      if (!targetJobId || p.jobId === targetJobId) {
        console.log(
          `[${++seq}] job:worker-status -> phase=${p.phase} coldStart=${p.coldStart} externalStatus=${p.externalStatus}`,
        );
      }
    });

    socket.on('job:progress', (p) => {
      if (!targetJobId || p.jobId === targetJobId) {
        console.log(
          `[${++seq}] job:progress -> ${p.percent}% stage=${p.stage} (${p.message})`,
        );
      }
    });

    socket.on('job:completed', (p) => {
      if (!targetJobId || p.jobId === targetJobId) {
        clearTimeout(timer);
        const asset = p.assets[0];
        const variantFiles = (asset?.files ?? []).filter((f) =>
          f.role.startsWith('VARIANT_'),
        );
        console.log(
          `[${++seq}] job:completed -> assets=${p.assets.length} executionMs=${p.executionMs}ms variants=${variantFiles.length}`,
        );
        for (const vf of variantFiles) {
          console.log(`    - ${vf.role}: ${vf.url} (${vf.width}x${vf.height})`);
        }
        resolve(p);
      }
    });

    socket.on('job:failed', (p) => {
      if (!targetJobId || p.jobId === targetJobId) {
        clearTimeout(timer);
        reject(new Error(`job:failed -> ${p.code}: ${p.message}`));
      }
    });
  });

  const postRes = await fetch(`${BASE_URL}/api/v1/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId: astra.id,
      executionMode: 'AUTO_FIRE',
      rawPrompt:
        'Aetherium relic shield emblem with obsidian bevels and cyan core',
      pinnedFileIds: [],
      params: {
        modality: 'ICONS_2D',
        iconCategory: 'RANK_EMBLEM',
        frameShape: 'HEXAGON',
        removeBackground: true,
        solidBackgroundHex: null,
        outputSize: 1024,
        batchCount: 1,
        seed: 300,
      },
      providerConfigId: demoProvider.id,
      skipMiddleman: false,
    }),
  });

  if (!postRes.ok) {
    const errText = await postRes.text();
    throw new Error(`POST /api/v1/jobs failed (${postRes.status}): ${errText}`);
  }
  const createdJob = await postRes.json();
  targetJobId = createdJob.id;

  const completedPayload = await donePromise;
  const asset = completedPayload.assets[0];
  const variant128 = asset.files.find((f) => f.role === 'VARIANT_128');
  if (!variant128) {
    throw new Error('Missing VARIANT_128 file on completed icon asset');
  }

  const getVariantRes = await fetch(`${BASE_URL}${variant128.url}`);
  if (!getVariantRes.ok) {
    throw new Error(
      `GET ${variant128.url} failed: ${getVariantRes.status}`,
    );
  }
  const buf = Buffer.from(await getVariantRes.arrayBuffer());
  const isPng =
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const bitDepth = buf[24];
  const colorType = buf[25]; // PNG colorType 6 = RGBA (truecolor with alpha)

  console.log(
    `[ws-smoke] GET ${variant128.url} -> status=${getVariantRes.status} content-type=${getVariantRes.headers.get('content-type')} bytes=${buf.length} isPng=${isPng} dimensions=${width}x${height} bitDepth=${bitDepth} colorType=${colorType} (hasAlpha=${colorType === 6 || colorType === 4})`,
  );

  socket.disconnect();
}

main().catch((err) => {
  console.error('[ws-smoke] ERROR:', err);
  process.exit(1);
});
