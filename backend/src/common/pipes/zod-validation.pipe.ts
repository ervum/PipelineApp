import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common';
import { ZodType, ZodTypeDef } from 'zod';

@Injectable()
export class ZodValidationPipe<TOutput = unknown> implements PipeTransform<unknown, TOutput> {
  constructor(private readonly schema: ZodType<TOutput, ZodTypeDef, unknown>) {}

  transform(value: unknown, _metadata: ArgumentMetadata): TOutput {
    return this.schema.parse(value ?? {});
  }
}
