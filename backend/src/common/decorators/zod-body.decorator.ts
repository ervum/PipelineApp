import { Body, Query } from '@nestjs/common';
import { ZodType, ZodTypeDef } from 'zod';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe';

export function ZodBody<TOutput>(
  schema: ZodType<TOutput, ZodTypeDef, unknown>,
): ParameterDecorator {
  return Body(new ZodValidationPipe(schema));
}

export function ZodQuery<TOutput>(
  schema: ZodType<TOutput, ZodTypeDef, unknown>,
): ParameterDecorator {
  return Query(new ZodValidationPipe(schema));
}
