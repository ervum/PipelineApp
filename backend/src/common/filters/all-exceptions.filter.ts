import { randomUUID } from 'node:crypto';
import { ErrorCode } from '@forge/shared';
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response } from 'express';
import { ZodError } from 'zod';
import { DomainError } from '../errors/domain.error';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const traceId = randomUUID();
    const isProd = process.env['NODE_ENV'] === 'production';

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: ErrorCode = ErrorCode.INTERNAL;
    let message = isProd ? 'Internal server error' : 'Unexpected internal error';
    let details: unknown;

    if (exception instanceof DomainError) {
      statusCode = exception.status;
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof ZodError) {
      statusCode = HttpStatus.BAD_REQUEST;
      code = ErrorCode.VALIDATION_FAILED;
      message = 'Request validation failed';
      details = exception.issues;
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        statusCode = HttpStatus.CONFLICT;
        code = ErrorCode.CONFLICT;
        message = 'Unique constraint conflict';
        details = exception.meta;
      } else if (exception.code === 'P2025') {
        statusCode = HttpStatus.NOT_FOUND;
        code = ErrorCode.NOT_FOUND;
        message = 'Requested record not found';
      } else {
        statusCode = HttpStatus.BAD_REQUEST;
        code = ErrorCode.VALIDATION_FAILED;
        message = isProd ? 'Database request error' : exception.message;
      }
    } else if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const body = exception.getResponse();
      message =
        typeof body === 'string'
          ? body
          : typeof body === 'object' && body !== null && 'message' in body
            ? String((body as { message: unknown }).message)
            : exception.message;
      if (statusCode === HttpStatus.NOT_FOUND) {
        code = ErrorCode.NOT_FOUND;
      } else if (statusCode === HttpStatus.CONFLICT) {
        code = ErrorCode.CONFLICT;
      } else if (statusCode === HttpStatus.PAYLOAD_TOO_LARGE) {
        code = ErrorCode.PAYLOAD_TOO_LARGE;
      } else if (statusCode >= 400 && statusCode < 500) {
        code = ErrorCode.VALIDATION_FAILED;
      }
    } else if (exception instanceof Error) {
      if (!isProd) {
        message = exception.message;
      }
    }

    if (statusCode >= 500) {
      this.logger.error(
        `[${traceId}] ${code} (${statusCode}): ${exception instanceof Error ? exception.stack ?? exception.message : String(exception)}`,
      );
    } else {
      this.logger.warn(`[${traceId}] ${code} (${statusCode}): ${message}`);
    }

    const payload: Record<string, unknown> = {
      statusCode,
      code,
      message,
      traceId,
    };
    if (details !== undefined) {
      payload['details'] = details;
    }

    res.status(statusCode).json(payload);
  }
}
