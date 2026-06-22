import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import {
  isDnsDomain,
  normalizeDomain,
  validateDnsDomain,
} from '../../bin/utils/domainValidator';

describe('domainValidator', () => {
  test('normalizes protocol and a single trailing slash', () => {
    expect(normalizeDomain('https://example.com/')).toBe('example.com');
    expect(normalizeDomain('http://demo.pinme/')).toBe('demo.pinme');
    expect(normalizeDomain('xhttps://example.com/')).toBe(
      'xhttps://example.com',
    );
    expect(normalizeDomain('https://example.com/path/')).toBe(
      'example.com/path',
    );
  });

  test('detects DNS domains after normalization', () => {
    expect(isDnsDomain('https://example.com/')).toBe(true);
    expect(isDnsDomain('my-site')).toBe(false);
  });

  test('accepts complete DNS domains', () => {
    expect(validateDnsDomain('example.com')).toEqual({ valid: true });
    expect(validateDnsDomain('sub.example.co')).toEqual({ valid: true });
  });

  test('rejects incomplete and malformed DNS domains', () => {
    expect(validateDnsDomain('localhost').valid).toBe(false);
    expect(validateDnsDomain('example..com').message).toMatch(/Consecutive/);
    expect(validateDnsDomain('-example.com').message).toMatch(/hyphens/);
    expect(validateDnsDomain('example-.com').message).toMatch(/hyphens/);
    expect(validateDnsDomain('exa_mple.com').message).toMatch(
      /letters, numbers, and hyphens/,
    );
    expect(validateDnsDomain('example.com.evil1').valid).toBe(false);
    expect(validateDnsDomain('prefix example.com').valid).toBe(false);
    expect(validateDnsDomain('example.com/path').valid).toBe(false);
    expect(validateDnsDomain('example.com?x=1').valid).toBe(false);
  });

  test('rejects labels longer than 63 characters', () => {
    const maxLabel = 'a'.repeat(63);
    const longLabel = 'a'.repeat(64);
    expect(validateDnsDomain(`${maxLabel}.com`).valid).toBe(true);
    expect(validateDnsDomain(`${longLabel}.com`).message).toMatch(
      /63 characters/,
    );
  });

  test('rejects empty labels in multiple positions', () => {
    expect(validateDnsDomain('.example.com').message).toMatch(/Consecutive/);
    expect(validateDnsDomain('example.com.').message).toMatch(/Consecutive/);
    expect(validateDnsDomain('example...com').message).toMatch(/Consecutive/);
  });

  test('property: valid simple domains are accepted', () => {
    fc.assert(
      fc.property(
        fc.array(fc.stringMatching(/^[a-z0-9]([a-z0-9-]{0,10}[a-z0-9])?$/), {
          minLength: 1,
          maxLength: 3,
        }),
        fc.stringMatching(/^[a-z]{2,10}$/),
        (labels, tld) => {
          fc.pre(labels.every((label) => label.length > 0));
          expect(validateDnsDomain([...labels, tld].join('.')).valid).toBe(
            true,
          );
        },
      ),
    );
  });
});
