import { seedAssetsAndJobs } from './seed/assets.seed';
import { seedMiddleman } from './seed/middleman.seed';
import { seedProjectAnime } from './seed/project-anime.seed';
import { seedProjectAstra } from './seed/project-astra.seed';
import { seedProviders } from './seed/providers.seed';
import { createSeedContext } from './seed/seed-context';

async function main(): Promise<void> {
  const startTime = Date.now();
  const ctx = createSeedContext();

  try {
    ctx.log('Resetting database tables in dependency order...');
    await ctx.prisma.generatedAssetFile.deleteMany();
    await ctx.prisma.generatedAsset.deleteMany();
    await ctx.prisma.generationJobEvent.deleteMany();
    await ctx.prisma.generationJob.deleteMany();
    await ctx.prisma.voiceProfile.deleteMany();
    await ctx.prisma.vaultFile.deleteMany();
    await ctx.prisma.vaultFolder.deleteMany();
    await ctx.prisma.middlemanTemplate.deleteMany();
    await ctx.prisma.middlemanProfile.deleteMany();
    await ctx.prisma.aiProviderConfig.deleteMany();
    await ctx.prisma.project.deleteMany();

    ctx.log('Clearing STORAGE_ROOT/projects...');
    await ctx.storage.deletePrefix('projects');

    ctx.log('Seeding 21 AI provider configurations...');
    const providers = await seedProviders(ctx);

    ctx.log('Seeding 5 Middleman profiles and 7 modality system templates...');
    const middleman = await seedMiddleman(ctx, providers);

    ctx.log('Seeding Project 1: "Astra Dream — 2D/3D Action RPG"...');
    const astra = await seedProjectAstra(ctx, providers);

    ctx.log('Seeding Project 2: "Anime Awakening RNG"...');
    const anime = await seedProjectAnime(ctx, providers);

    ctx.log('Seeding 39 generation jobs and 45 procedural assets across all 7 modalities...');
    await seedAssetsAndJobs(ctx, providers, middleman, astra, anime);

    const [
      projectCount,
      folderCount,
      vaultFileCount,
      providerCount,
      profileCount,
      templateCount,
      voiceProfileCount,
      jobCount,
      completedJobCount,
      awaitingReviewJobCount,
      failedJobCount,
      cancelledJobCount,
      jobEventCount,
      assetCount,
      assetFileCount,
    ] = await Promise.all([
      ctx.prisma.project.count(),
      ctx.prisma.vaultFolder.count(),
      ctx.prisma.vaultFile.count(),
      ctx.prisma.aiProviderConfig.count(),
      ctx.prisma.middlemanProfile.count(),
      ctx.prisma.middlemanTemplate.count(),
      ctx.prisma.voiceProfile.count(),
      ctx.prisma.generationJob.count(),
      ctx.prisma.generationJob.count({ where: { status: 'COMPLETED' } }),
      ctx.prisma.generationJob.count({ where: { status: 'AWAITING_REVIEW' } }),
      ctx.prisma.generationJob.count({ where: { status: 'FAILED' } }),
      ctx.prisma.generationJob.count({ where: { status: 'CANCELLED' } }),
      ctx.prisma.generationJobEvent.count(),
      ctx.prisma.generatedAsset.count(),
      ctx.prisma.generatedAssetFile.count(),
    ]);

    const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(2);
    const mbWritten = (ctx.getTotalBytesWritten() / (1024 * 1024)).toFixed(2);

    console.log('\n┌──────────────────────────────────────────────────────────────┐');
    console.log('│          ForgeStudio Control Room — Seed Summary             │');
    console.log('├───────────────────────────────────┬──────────────────────────┤');
    console.log(`│ Projects                          │ ${String(projectCount).padEnd(24)} │`);
    console.log(`│ Vault Folders (incl. 2 roots)     │ ${String(folderCount).padEnd(24)} │`);
    console.log(`│ Vault Files                       │ ${String(vaultFileCount).padEnd(24)} │`);
    console.log(`│ AI Provider Configs               │ ${String(providerCount).padEnd(24)} │`);
    console.log(`│ Middleman Profiles                │ ${String(profileCount).padEnd(24)} │`);
    console.log(`│ Middleman Templates               │ ${String(templateCount).padEnd(24)} │`);
    console.log(`│ Voice Profiles                    │ ${String(voiceProfileCount).padEnd(24)} │`);
    console.log(
      `│ Generation Jobs (total)           │ ${`${jobCount} (${completedJobCount} COMPLETED, ${awaitingReviewJobCount} REVIEW, ${failedJobCount} FAILED, ${cancelledJobCount} CANCELLED)`.padEnd(24)} │`,
    );
    console.log(`│ Generation Job Events             │ ${String(jobEventCount).padEnd(24)} │`);
    console.log(`│ Generated Assets                  │ ${String(assetCount).padEnd(24)} │`);
    console.log(`│ Generated Asset Files             │ ${String(assetFileCount).padEnd(24)} │`);
    console.log(`│ Storage Bytes Written             │ ${`${ctx.getTotalBytesWritten()} (${mbWritten} MB)`.padEnd(24)} │`);
    console.log(`│ Elapsed Time                      │ ${`${elapsedSec} s`.padEnd(24)} │`);
    console.log('└───────────────────────────────────┴──────────────────────────┘\n');
  } finally {
    await ctx.prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[seed] Fatal error:', err);
  process.exit(1);
});
