import { HttpStatus, Logger, NotImplementedException } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { SigaaExceptionFilter } from './sigaa-exception.filter';
import {
  SigaaCredentialsRequiredError,
  SigaaInvalidCredentialsError,
  SigaaSessionExpiredError,
} from './session';
import { SigaaRateLimitedError } from './http-client';
import { SigaaScheduleUnavailableError } from './schedule.service';
import {
  ComponenteDesconhecidoError,
  CursoDesconhecidoError,
} from '../curriculo/curriculo.service';

function fakeHost() {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
    }),
  };
  return { host: host as unknown as ArgumentsHost, status, json };
}

describe('SigaaExceptionFilter', () => {
  const filter = new SigaaExceptionFilter();

  it('maps SigaaInvalidCredentialsError to 401 with the error message', () => {
    const { host, status, json } = fakeHost();
    const error = new SigaaInvalidCredentialsError();

    filter.catch(error, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED);
    expect(json).toHaveBeenCalledWith({
      statusCode: HttpStatus.UNAUTHORIZED,
      message: error.message,
    });
  });

  it('maps SigaaCredentialsRequiredError to 401', () => {
    const { host, status } = fakeHost();

    filter.catch(new SigaaCredentialsRequiredError(), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED);
  });

  it('maps SigaaSessionExpiredError to 401', () => {
    const { host, status } = fakeHost();

    filter.catch(new SigaaSessionExpiredError(), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED);
  });

  it('maps SigaaRateLimitedError to 429', () => {
    const { host, status } = fakeHost();

    filter.catch(new SigaaRateLimitedError(), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.TOO_MANY_REQUESTS);
  });

  it('maps SigaaScheduleUnavailableError to 503, keeping the reassurance message', () => {
    const { host, status, json } = fakeHost();
    const error = new SigaaScheduleUnavailableError(6);

    filter.catch(error, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    expect(json).toHaveBeenCalledWith({
      statusCode: HttpStatus.SERVICE_UNAVAILABLE,
      message: error.message,
    });
  });

  it('maps CursoDesconhecidoError to 404', () => {
    const { host, status, json } = fakeHost();
    const error = new CursoDesconhecidoError('999');

    filter.catch(error, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(json).toHaveBeenCalledWith({
      statusCode: HttpStatus.NOT_FOUND,
      message: error.message,
    });
  });

  it('maps ComponenteDesconhecidoError to 404', () => {
    const { host, status, json } = fakeHost();
    const error = new ComponenteDesconhecidoError('NAOEXISTE01', '999');

    filter.catch(error, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(json).toHaveBeenCalledWith({
      statusCode: HttpStatus.NOT_FOUND,
      message: error.message,
    });
  });

  it('leaves an existing HttpException (e.g. NotImplementedException) untouched', () => {
    const { host, status, json } = fakeHost();
    const error = new NotImplementedException('parser pending');

    filter.catch(error, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.NOT_IMPLEMENTED);
    expect(json).toHaveBeenCalledWith(error.getResponse());
  });

  it('falls back to 500 for an unrecognized error', () => {
    const { host, status, json } = fakeHost();
    const error = new Error('boom');

    filter.catch(error, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(json).toHaveBeenCalledWith({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'boom',
    });
  });

  it('logs the exception (with stack) when it falls back to 500, so it shows up server-side instead of only in the response body', () => {
    const { host } = fakeHost();
    const error = new Error('boom');
    const logSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();

    filter.catch(error, host);

    expect(logSpy).toHaveBeenCalledWith(error.message, error.stack);
    logSpy.mockRestore();
  });
});
