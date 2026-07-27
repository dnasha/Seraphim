import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchPublicBytes: vi.fn(),
}));

vi.mock('@/lib/security/ogImage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/security/ogImage')>();
  return {
    ...actual,
    fetchPublicBytes: mocks.fetchPublicBytes,
  };
});

import {
  fetchPageImageCandidate,
  imageDimensions,
  probePublicNewsImage,
} from '@/lib/api/pageImages';

function png(width: number, height: number) {
  const bytes = new Uint8Array(32);
  bytes.set([0x89, 0x50, 0x4e, 0x47], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

beforeEach(() => {
  mocks.fetchPublicBytes.mockReset();
});

describe('page image metadata', () => {
  it('resolves OG image URLs and validates usable dimensions', async () => {
    mocks.fetchPublicBytes
      .mockResolvedValueOnce({
        bytes: new TextEncoder().encode(
          '<meta property="og:image" content="/media/report.jpg">',
        ),
        contentType: 'text/html',
        finalUrl: 'https://news.example.com/story',
        truncated: false,
      })
      .mockResolvedValueOnce({
        bytes: png(1200, 675),
        contentType: 'image/png',
        finalUrl: 'https://news.example.com/media/report.jpg',
        truncated: true,
      });

    await expect(fetchPageImageCandidate({
      articleUrl: 'https://news.example.com/story',
      sourcePublishedAt: '2026-07-27T00:00:00.000Z',
      sourceTier: 1,
    })).resolves.toMatchObject({
      url: 'https://news.example.com/media/report.jpg',
      sourceUrl: 'https://news.example.com/story',
      origin: 'page-og',
      width: 1200,
      height: 675,
    });
  });

  it('rejects SVG and tiny raster candidates', async () => {
    mocks.fetchPublicBytes.mockResolvedValueOnce({
      bytes: new Uint8Array(2048),
      contentType: 'image/svg+xml',
      finalUrl: 'https://news.example.com/logo.svg',
      truncated: false,
    });
    await expect(probePublicNewsImage('https://news.example.com/logo.svg')).resolves.toBeNull();

    mocks.fetchPublicBytes.mockResolvedValueOnce({
      bytes: png(50, 50),
      contentType: 'image/png',
      finalUrl: 'https://news.example.com/tiny.png',
      truncated: false,
    });
    await expect(probePublicNewsImage('https://news.example.com/tiny.png')).resolves.toBeNull();
  });

  it('reads PNG dimensions from a bounded prefix', () => {
    expect(imageDimensions(png(640, 360), 'image/png')).toEqual({
      width: 640,
      height: 360,
    });
  });
});
