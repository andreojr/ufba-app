import { HttpStatus, NotImplementedException } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { SigaaExceptionFilter } from './sigaa-exception.filter';
import {
  SigaaCredentialsRequiredError,
  SigaaInvalidCredentialsError,
  SigaaSessionExpiredError,
} from './session';
import { SigaaRateLimitedError } from './http-client';

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
});
