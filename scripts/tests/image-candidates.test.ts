import { describe, expect, it } from 'vitest';
import { extractFeedImageCandidate } from '@/lib/api/imageCandidates';

const input = {
  articleUrl: 'https://news.example.com/story',
  sourcePublishedAt: '2026-07-27T00:00:00.000Z',
  sourceTier: 2,
};

describe('feed image candidates', () => {
  it('supports array MediaRSS and keeps dimensions', () => {
    expect(extractFeedImageCandidate({
      'media:content': [
        { $: { url: 'https://cdn.example.com/photo.jpg', width: '1200', height: '675' } },
      ],
    }, input)).toMatchObject({
      url: 'https://cdn.example.com/photo.jpg',
      width: 1200,
      height: 675,
      origin: 'feed',
    });
  });

  it('walks media groups and image enclosures', () => {
    expect(extractFeedImageCandidate({
      'media:group': [{
        'media:thumbnail': { $: { url: '/images/group.webp' } },
      }],
      enclosure: { url: 'https://cdn.example.com/fallback.mp4', type: 'video/mp4' },
    }, input)?.url).toBe('https://news.example.com/images/group.webp');
  });

  it('falls back to embedded content images and excludes obvious icons', () => {
    expect(extractFeedImageCandidate({
      'content:encoded': `
        <img src="https://cdn.example.com/icon.png">
        <img src="https://cdn.example.com/report.jpg">
      `,
    }, input)).toMatchObject({
      url: 'https://cdn.example.com/report.jpg',
      origin: 'feed-html',
    });
  });

  it('rejects video enclosures and unsafe URLs', () => {
    expect(extractFeedImageCandidate({
      enclosure: [
        { url: 'https://cdn.example.com/video.mp4', type: 'video/mp4' },
        { url: 'file:///etc/passwd', type: 'image/jpeg' },
      ],
    }, input)).toBeNull();
  });
});
