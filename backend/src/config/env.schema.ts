import { z } from 'zod';

export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    FORGE_MASTER_KEY: z.string().min(1, 'FORGE_MASTER_KEY is required'),
    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    STORAGE_ROOT: z.string().default('./storage'),
    S3_ENDPOINT: z.string().default('http://localhost:9000'),
    S3_REGION: z.string().default('us-east-1'),
    S3_BUCKET: z.string().default('forgestudio'),
    S3_ACCESS_KEY_ID: z.string().default(''),
    S3_SECRET_ACCESS_KEY: z.string().default(''),
    S3_FORCE_PATH_STYLE: z
      .union([z.boolean(), z.string()])
      .transform((v) => v === true || v === 'true' || v === '1')
      .default(true),
    PUBLIC_WEBHOOK_BASE_URL: z.string().default(''),
    WEBHOOK_SIGNING_SECRET: z.string().default('forgestudio-dev-webhook-secret'),
    CORS_ORIGIN: z.string().default('http://localhost:4200'),
    JOB_WORKER_TICK_MS: z.coerce.number().int().min(100).max(60000).default(1000),
    JOB_MAX_CONCURRENT_GLOBAL: z.coerce.number().int().min(1).max(64).default(6),
    MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(1000).default(200),
  })
  .superRefine((env, ctx) => {
    try {
      const buf = Buffer.from(env.FORGE_MASTER_KEY.trim(), 'base64');
      if (buf.length !== 32) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['FORGE_MASTER_KEY'],
          message: `FORGE_MASTER_KEY must decode to exactly 32 bytes (got ${buf.length}). Run \`npm run keygen -w @forge/backend\` to generate one.`,
        });
      }
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['FORGE_MASTER_KEY'],
        message:
          'FORGE_MASTER_KEY is not valid base64. Run `npm run keygen -w @forge/backend` to generate one.',
      });
    }
  });

export type AppEnv = z.infer<typeof EnvSchema>;

export function validateEnv(rawEnv: Record<string, unknown>): AppEnv {
  const parsed = EnvSchema.safeParse(rawEnv);
  if (!parsed.success) {
    const formatted = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || 'env'}: ${i.message}`)
      .join('\n');
    console.error(
      `\n[ForgeStudio] Invalid environment configuration:\n${formatted}\nHint: Run \`npm run keygen -w @forge/backend\` to generate a valid FORGE_MASTER_KEY.\n`,
    );
    process.exit(1);
  }
  return parsed.data;
}
