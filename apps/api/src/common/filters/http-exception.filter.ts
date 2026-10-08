import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { Response, Request } from 'express';
import { humanizeFieldNamesInText } from '../validation-messages';

/** Drizzle wraps driver failures in cause. Never expose SQL or constraint data. */
export function isDuplicateEntry(error: unknown): boolean {
  const seen = new Set<unknown>();
  for (let current = error; current && typeof current === 'object' && !seen.has(current);) {
    seen.add(current);
    if ('code' in current && current.code === 'ER_DUP_ENTRY') return true;
    current = 'cause' in current ? current.cause : undefined;
  }
  return false;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : isDuplicateEntry(exception) ? HttpStatus.CONFLICT : HttpStatus.INTERNAL_SERVER_ERROR;

    if (status === HttpStatus.INTERNAL_SERVER_ERROR) {
      console.error('Unhandled Exception:', exception);
    } else if (isDuplicateEntry(exception)) {
      console.warn('[HttpExceptionFilter] Duplicate Entry Conflict:', (exception as any)?.cause?.message || (exception as any)?.message || exception);
    }

    const rawMessage =
      exception instanceof HttpException
        ? exception.getResponse()
        : status === HttpStatus.CONFLICT
          ? 'A record with this unique code or identity already exists. Refresh and try another code.'
          : 'Something went wrong on our side. Please try again, and contact support if it keeps happening.';
    const message = humanizeResponse(rawMessage);

    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      error: typeof message === 'string' ? { message } : message,
    });
  }
}

/**
 * A raw request or column name (`boar_animal_id`) is never what a person should
 * read. Messages are written to avoid them; this catches any that slip through.
 */
function humanizeResponse(response: string | object): string | object {
  if (typeof response === 'string') return humanizeFieldNamesInText(response);
  const body = response as { message?: unknown };
  if (typeof body.message === 'string') return { ...body, message: humanizeFieldNamesInText(body.message) };
  if (Array.isArray(body.message)) {
    return { ...body, message: body.message.map((m) => (typeof m === 'string' ? humanizeFieldNamesInText(m) : m)) };
  }
  return response;
}
