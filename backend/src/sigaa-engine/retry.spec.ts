import { withRetry } from './retry';

describe('withRetry', () => {
  it('returns the result on first success without retrying', async () => {
    const fn = jest.fn().mockResolvedValue('ok');

    const result = await withRetry(fn, { sleep: async () => {} });

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries once after a failure and returns the second attempt result', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('network timeout'))
      .mockResolvedValueOnce('ok');

    const result = await withRetry(fn, { retries: 1, sleep: async () => {} });

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws the last error once retries are exhausted', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('still failing'));

    await expect(
      withRetry(fn, { retries: 1, sleep: async () => {} }),
    ).rejects.toThrow('still failing');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('sleeps with an increasing backoff between attempts', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce('ok');
    const sleep = jest.fn().mockResolvedValue(undefined);

    await withRetry(fn, { retries: 1, backoffMs: 200, sleep });

    expect(sleep).toHaveBeenCalledWith(200);
  });

  it('does not retry when shouldRetry returns false for the error', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('do not retry me'));
    const shouldRetry = jest.fn().mockReturnValue(false);

    await expect(
      withRetry(fn, { retries: 2, sleep: async () => {}, shouldRetry }),
    ).rejects.toThrow('do not retry me');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
