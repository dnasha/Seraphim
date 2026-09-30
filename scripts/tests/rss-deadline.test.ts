import {afterEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({fetch:vi.fn(),parse:vi.fn()}));
vi.mock('@/lib/security/feedFetch',()=>({fetchBoundedFeed:mocks.fetch}));
vi.mock('rss-parser',()=>({default:class {parseString=mocks.parse;}}));
import {fetchSingleFeed} from '@/lib/api/rss';
const source={name:'Budget',url:'https://primary.example/rss',fallbackUrls:['https://fallback.example/rss'],category:'world',credibility_tier:1 as const};
afterEach(()=>{vi.resetAllMocks();vi.useRealTimers();});
describe('RSS end-to-end budget',()=>{
  it('reserves fallback time and shares one deadline signal across URLs',async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-30T00:00:00Z'));
    mocks.fetch.mockImplementationOnce(async()=>{vi.setSystemTime(Date.now()+1500);throw new Error('timeout');})
      .mockResolvedValueOnce({notModified:false,text:'<rss/>'});
    mocks.parse.mockResolvedValue({items:[]});
    await fetchSingleFeed(source,1000);
    expect(mocks.fetch.mock.calls[0][1]).toMatchObject({timeoutMs:1000,maxAttempts:1});
    expect(mocks.fetch.mock.calls[1][1]).toMatchObject({timeoutMs:500,maxAttempts:1});
    expect(mocks.fetch.mock.calls[1][1].signal).toBe(mocks.fetch.mock.calls[0][1].signal);
  });
  it('does not start another URL after the shared deadline is exhausted',async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-30T00:00:00Z'));
    mocks.fetch.mockImplementationOnce(async()=>{vi.setSystemTime(Date.now()+2001);throw new Error('timeout');});
    await fetchSingleFeed(source,1000);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
});
