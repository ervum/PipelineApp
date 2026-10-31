import { z } from 'zod';
import { SEED_MAX } from '../constants/limits';

export const IdSchema = z.string().min(1).max(64);
export const HexColorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
export const SeedSchema = z.number().int().min(0).max(SEED_MAX);

export const PaginationQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(40),
});

export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
  total: number;
}
