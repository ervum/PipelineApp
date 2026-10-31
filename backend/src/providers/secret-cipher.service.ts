import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { ErrorCode } from '@forge/shared';
import { Injectable, Optional } from '@nestjs/common';
import { DomainError } from '../common/errors/domain.error';

@Injectable()
export class SecretCipherService {
  private readonly key: Buffer;

  constructor(@Optional() masterKeyInput?: string | Buffer) {
    const raw = masterKeyInput ?? process.env['FORGE_MASTER_KEY'];
    if (!raw) {
      throw new Error(
        'FORGE_MASTER_KEY is required (base64 of 32 random bytes). Run `npm run keygen -w @forge/backend` to generate one.',
      );
    }
    const keyBuf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw.trim(), 'base64');
    if (keyBuf.length !== 32) {
      throw new Error(
        `FORGE_MASTER_KEY must decode to exactly 32 bytes (got ${keyBuf.length}). Run \`npm run keygen -w @forge/backend\` to generate one.`,
      );
    }
    this.key = keyBuf;
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${enc.toString('base64')}`;
  }

  decrypt(payload: string): string {
    const parts = payload.split(':');
    if (parts.length !== 4) {
      throw new DomainError(ErrorCode.INTERNAL, 500, 'Secret decryption failed');
    }
    const [v, ivB, tagB, encB] = parts;
    if (v !== 'v1' || !ivB || !tagB || !encB) {
      throw new DomainError(ErrorCode.INTERNAL, 500, 'Secret decryption failed');
    }
    try {
      const iv = Buffer.from(ivB, 'base64');
      const tag = Buffer.from(tagB, 'base64');
      if (iv.length !== 12 || tag.length !== 16) {
        throw new Error('Invalid IV or auth tag length');
      }
      const d = createDecipheriv('aes-256-gcm', this.key, iv);
      d.setAuthTag(tag);
      return Buffer.concat([d.update(Buffer.from(encB, 'base64')), d.final()]).toString('utf8');
    } catch {
      throw new DomainError(ErrorCode.INTERNAL, 500, 'Secret decryption failed');
    }
  }

  last4(plain: string): string {
    return plain.slice(-4);
  }
}
