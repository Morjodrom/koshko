import { describe, expect, it } from 'vitest';
import { createConfig, isLiteralLoopback } from './config';
import { authToken } from './test-fixtures';

describe('companion configuration', () => {
  it('only permits literal loopback hosts', () => {
    expect(isLiteralLoopback('127.0.0.1')).toBe(true);
    expect(isLiteralLoopback('::1')).toBe(true);
    expect(isLiteralLoopback('localhost')).toBe(false);
    expect(isLiteralLoopback('0.0.0.0')).toBe(false);
    expect(() => createConfig({ token: authToken, host: '192.168.1.2' }, {})).toThrow('literal loopback');
  });
});
