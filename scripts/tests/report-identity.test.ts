import { describe, expect, it } from 'vitest';
import { reportIdentityKey } from '@/lib/utils/reportIdentity';
import { countIndependentSources } from '@/lib/utils/corroboration';

describe('report identity', () => {
  it.each(['x.com', 'twitter.com', 'mobile.twitter.com', 'nitter.privacydev.net', 'nitter.poast.org', 'xcancel.com', 'nitter.cz', 'nitter.jaydenha.uk', 'nitter.kareem.one', 'nitter.netbub.com', 'shitter.thepixora.com', 'x.yuuki.sh'])('uses status identity for known host %s', host => {
    expect(reportIdentityKey(`https://${host}/account/status/123456789?utm_source=feed#r`)).toBe('x-status:123456789');
  });
  it('does not collapse other platforms, untrusted hosts or different status IDs', () => {
    expect(reportIdentityKey('https://example.com/account/status/123456789')).not.toBe('x-status:123456789');
    expect(reportIdentityKey('https://xcancel.com.evil.example/account/status/123456789')).not.toBe('x-status:123456789');
    expect(reportIdentityKey('https://x.com/account/status/987654321')).not.toBe('x-status:123456789');
  });
  it('does not count one mirrored status as independent reporting when display names differ', () => {
    expect(countIndependentSources({ name: 'Account', source_type: 'social', url: 'https://x.com/account/status/123456789' },
      [{ name: 'Account (X)', source_type: 'social', url: 'https://xcancel.com/account/status/123456789' }])).toBe(1);
  });
  it('recognizes one DW article distributed in different RSS feeds', () => {
    const article = 'https://www.dw.com/en/a-romani-artist-in-hungary-reclaims-his-identity/a-79247266';
    expect(reportIdentityKey(`${article}?maca=en-rss-en-top-1022-rdf`))
      .toBe(reportIdentityKey(`${article}?maca=en-rss-en-eu-2092-rdf`));
    expect(reportIdentityKey('https://example.com/story?maca=one'))
      .not.toBe(reportIdentityKey('https://example.com/story?maca=two'));
    expect(reportIdentityKey('https://www.dw.com/en/different/a-1234'))
      .not.toBe(reportIdentityKey(article));
  });
});
