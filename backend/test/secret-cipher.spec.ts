import { randomBytes } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { DomainError } from '../src/common/errors/domain.error';
import { SecretCipherService } from '../src/providers/secret-cipher.service';
import { LocalStorageDriver } from '../src/storage/drivers/local-storage.driver';

describe('SecretCipherService & LocalStorageDriver security guards', () => {
  const validKeyA = randomBytes(32).toString('base64');
  const validKeyB = randomBytes(32).toString('base64');

  describe('SecretCipherService', () => {
    it('encrypts and decrypts secrets round-trip with v1 envelope format', () => {
      const cipher = new SecretCipherService(validKeyA);
      const secret = 'sk-ant-api03-test-secret-value-9876';
      const encrypted = cipher.encrypt(secret);

      expect(encrypted.startsWith('v1:')).toBe(true);
      expect(encrypted.split(':')).toHaveLength(4);
      expect(encrypted).not.toContain(secret);
      expect(cipher.decrypt(encrypted)).toBe(secret);
    });

    it('produces distinct ciphertexts for identical plaintexts (random IV)', () => {
      const cipher = new SecretCipherService(validKeyA);
      const a = cipher.encrypt('same-secret');
      const b = cipher.encrypt('same-secret');
      expect(a).not.toBe(b);
      expect(cipher.decrypt(a)).toBe('same-secret');
      expect(cipher.decrypt(b)).toBe('same-secret');
    });

    it('throws DomainError when ciphertext or authTag is tampered', () => {
      const cipher = new SecretCipherService(validKeyA);
      const encrypted = cipher.encrypt('sensitive-api-key-1234');
      const [v, iv, tag, body] = encrypted.split(':');

      const flippedBody = Buffer.from(body!, 'base64');
      flippedBody[0] = (flippedBody[0] ?? 0) ^ 0xff;
      const tamperedPayload = `${v}:${iv}:${tag}:${flippedBody.toString('base64')}`;

      expect(() => cipher.decrypt(tamperedPayload)).toThrow(DomainError);

      const flippedTag = Buffer.from(tag!, 'base64');
      flippedTag[0] = (flippedTag[0] ?? 0) ^ 0xff;
      const tamperedTagPayload = `${v}:${iv}:${flippedTag.toString('base64')}:${body}`;

      expect(() => cipher.decrypt(tamperedTagPayload)).toThrow(DomainError);
    });

    it('throws DomainError when decrypting with the wrong master key', () => {
      const cipherA = new SecretCipherService(validKeyA);
      const cipherB = new SecretCipherService(validKeyB);
      const encrypted = cipherA.encrypt('secret-for-key-A');

      expect(() => cipherB.decrypt(encrypted)).toThrow(DomainError);
    });

    it('returns the last 4 characters via last4()', () => {
      const cipher = new SecretCipherService(validKeyA);
      expect(cipher.last4('sk-live-abcdef1234')).toBe('1234');
      expect(cipher.last4('xy')).toBe('xy');
    });

    it('rejects invalid master key lengths on construction', () => {
      const shortKey = randomBytes(16).toString('base64');
      expect(() => new SecretCipherService(shortKey)).toThrow(/32 bytes/);
    });
  });

  describe('LocalStorageDriver path traversal guard', () => {
    let tmpDir: string;
    let driver: LocalStorageDriver;

    beforeAll(async () => {
      tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-storage-spec-'));
      driver = new LocalStorageDriver(tmpDir);
    });

    afterAll(async () => {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    });

    it('rejects .. segments, backslashes, leading slashes, and NUL bytes', () => {
      const maliciousKeys = [
        '../etc/passwd',
        'projects/../../secret.txt',
        'projects\\astra\\file.png',
        '/absolute/path/file.png',
        'projects/astra/file\0.png',
        'projects//double-slash.png',
        'projects/./dot.png',
      ];

      for (const badKey of maliciousKeys) {
        expect(() => driver.resolveSafe(badKey)).toThrow(DomainError);
      }
    });

    it('stores, stats, reads byte ranges, and deletes valid keys atomically', async () => {
      const key = 'projects/p1/vault/f1/palette.md';
      const content = Buffer.from('# Palette\nPrimary: #7C3AED\nSecondary: #F5C451\n', 'utf8');

      const stat = await driver.put(key, content, 'text/markdown');
      expect(stat.sizeBytes).toBe(content.length);
      expect(stat.mimeType).toBe('text/markdown');
      expect(stat.etag).toHaveLength(64);

      const loaded = await driver.getBuffer(key);
      expect(loaded.equals(content)).toBe(true);

      const rangeStream = await driver.getStream(key, { start: 0, end: 8 });
      const chunks: Buffer[] = [];
      for await (const c of rangeStream) {
        chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
      }
      expect(Buffer.concat(chunks).toString('utf8')).toBe('# Palette');

      await driver.delete(key);
      expect(await driver.stat(key)).toBeNull();
    });
  });
});
