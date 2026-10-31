import { createHash } from 'node:crypto';
import * as path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { SecretCipherService } from '../../src/providers/secret-cipher.service';
import { LocalStorageDriver } from '../../src/storage/drivers/local-storage.driver';
import { ImageProcessingService } from '../../src/storage/image-processing.service';
import { StorageService } from '../../src/storage/storage.service';
import { mulberry32 } from '../../src/synth/rng';

export interface SeedContext {
  prisma: PrismaClient;
  driver: LocalStorageDriver;
  storage: StorageService;
  cipher: SecretCipherService;
  image: ImageProcessingService;
  rng: () => number;
  nextSeedInt: () => number;
  recordBytes: (bytes: number) => void;
  getTotalBytesWritten: () => number;
  log: (msg: string) => void;
}

export function createSeedContext(): SeedContext {
  const prisma = new PrismaClient();
  const storageRoot = process.env['STORAGE_ROOT']
    ? path.resolve(process.env['STORAGE_ROOT'])
    : path.resolve(__dirname, '..', '..', 'storage');

  const driver = new LocalStorageDriver(storageRoot);
  const storage = new StorageService(driver);

  let masterKey: string | Buffer | undefined = process.env['FORGE_MASTER_KEY']?.trim();
  if (!masterKey || Buffer.from(masterKey, 'base64').length !== 32) {
    masterKey = createHash('sha256')
      .update('forgestudio-dev-seed-master-key-20261022')
      .digest();
  }

  const cipher = new SecretCipherService(masterKey);
  const image = new ImageProcessingService();
  const rng = mulberry32(20261022);

  let bytesWritten = 0;

  return {
    prisma,
    driver,
    storage,
    cipher,
    image,
    rng,
    nextSeedInt: (): number => Math.floor(rng() * 2_147_483_647),
    recordBytes: (b: number): void => {
      bytesWritten += b;
    },
    getTotalBytesWritten: (): number => bytesWritten,
    log: (msg: string): void => {
      console.log(`[seed] ${msg}`);
    },
  };
}
