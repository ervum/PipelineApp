import { z } from 'zod';

export const McpInvokeToolSchema = z.object({
  name: z.string().trim().min(1).max(120),
  arguments: z.record(z.unknown()).default({}),
});

export type McpInvokeToolDto = z.infer<typeof McpInvokeToolSchema>;
