import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  SigaaCredentialsRequiredError,
  SigaaInvalidCredentialsError,
  SigaaSessionExpiredError,
} from './session';
import { SigaaRateLimitedError } from './http-client';

const STATUS_BY_ERROR_NAME: Record<string, HttpStatus> = {
  [SigaaInvalidCredentialsError.name]: HttpStatus.UNAUTHORIZED,
  [SigaaCredentialsRequiredError.name]: HttpStatus.UNAUTHORIZED,
  [SigaaSessionExpiredError.name]: HttpStatus.UNAUTHORIZED,
  [SigaaRateLimitedError.name]: HttpStatus.TOO_MANY_REQUESTS,
};

/**
 * Maps the sigaa-engine's domain errors (which are plain `Error` subclasses, not
 * `HttpException`s) to the HTTP status a client can actually branch on, instead of
 * letting them fall through to Nest's default 500. Anything not in the map above
 * (including genuinely unexpected errors) still becomes a 500, same as before.
 */
@Catch(
  SigaaInvalidCredentialsError,
  SigaaCredentialsRequiredError,
  SigaaSessionExpiredError,
  SigaaRateLimitedError,
  Error,
)
export class SigaaExceptionFilter implements ExceptionFilter {
  catch(exception: Error, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    // Anything already an HttpException (NotImplementedException, Nest's own
    // validation BadRequestException, etc.) already knows its correct status and
    // response body — leave it untouched instead of collapsing it to 500.
    if (exception instanceof HttpException) {
      response.status(exception.getStatus()).json(exception.getResponse());
      return;
    }

    const status =
      STATUS_BY_ERROR_NAME[exception.name] ?? HttpStatus.INTERNAL_SERVER_ERROR;

    response.status(status).json({
      statusCode: status,
      message: exception.message,
    });
  }
}
