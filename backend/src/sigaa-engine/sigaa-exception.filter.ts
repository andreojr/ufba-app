import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  SigaaCredentialsRequiredError,
  SigaaInvalidCredentialsError,
  SigaaSessionExpiredError,
} from './session';
import { SigaaRateLimitedError } from './http-client';
import { SigaaScheduleUnavailableError } from './schedule.service';
import { SigaaScheduleIndisponivelError } from './sigaa-engine.service';
import {
  ComponenteDesconhecidoError,
  CursoDesconhecidoError,
} from '../curriculo/curriculo.service';

const STATUS_BY_ERROR_NAME: Record<string, HttpStatus> = {
  [SigaaInvalidCredentialsError.name]: HttpStatus.UNAUTHORIZED,
  [SigaaCredentialsRequiredError.name]: HttpStatus.UNAUTHORIZED,
  [SigaaSessionExpiredError.name]: HttpStatus.UNAUTHORIZED,
  [SigaaRateLimitedError.name]: HttpStatus.TOO_MANY_REQUESTS,
  // SIGAA answered (login worked) but gave back a degraded/empty schedule —
  // distinct from a 500: the client needs to say "your data is safe, try
  // again later" instead of the generic "something broke" message.
  [SigaaScheduleUnavailableError.name]: HttpStatus.SERVICE_UNAVAILABLE,
  // O atestado de matrícula não rendeu turma identificável (sem código ou
  // sem número) — um 502 porque a origem é o SIGAA, não o cliente.
  [SigaaScheduleIndisponivelError.name]: HttpStatus.BAD_GATEWAY,
  // An unknown cursoId — either /curriculo/cursos/:cursoId with an id not in
  // the directory, or resolverPorNomeUsuario finding no match — is a client
  // error about *what* was asked for, not a server failure.
  [CursoDesconhecidoError.name]: HttpStatus.NOT_FOUND,
  // Same reasoning as CursoDesconhecidoError, one level down: the código
  // itself isn't in the course's active curriculum structure.
  [ComponenteDesconhecidoError.name]: HttpStatus.NOT_FOUND,
};

/**
 * A 401 alone doesn't tell the client *whose* credentials were rejected: the
 * JwtAuthGuard answers 401 when our own access token expires, and three
 * different SIGAA errors answer 401 too. Only one of them means "the student
 * changed their SIGAA password" — this tag marks it, so the app can flag the
 * saved password as stale without doing it every time a JWT lapses.
 */
const ERROR_CODE_BY_NAME: Record<string, string> = {
  [SigaaInvalidCredentialsError.name]: 'SIGAA_INVALID_CREDENTIALS',
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
  private readonly logger = new Logger(SigaaExceptionFilter.name);

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

    // Genuinely unexpected errors used to vanish into the response body only —
    // the client sees a generic "something went wrong", but nothing showed up
    // server-side to debug from. Log the stack for exactly that case.
    if (status === HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(exception.message, exception.stack);
    }

    const code = ERROR_CODE_BY_NAME[exception.name];

    response.status(status).json({
      statusCode: status,
      message: exception.message,
      ...(code ? { code } : {}),
    });
  }
}
