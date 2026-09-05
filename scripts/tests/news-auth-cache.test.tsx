// @vitest-environment jsdom
import {act,cleanup,renderHook,waitFor} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {useNewsData} from '@/hooks/useNewsData';
import {responseCache,inFlightFetches} from '@/hooks/news/cacheUtils';
const row={id:'11111111-1111-4111-8111-111111111111',title:'Audit',url:'https://example.com',source:'Example',sourceType:'rss' as const,publishedAt:new Date().toISOString(),latitude:10,longitude:20};
const bbox={minLat:-90,maxLat:90,minLng:-180,maxLng:180,centerLat:0,centerLng:0,zoom:1};
function response(value:unknown){return new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});}
afterEach(()=>{cleanup();responseCache.clear();inFlightFetches.clear();vi.restoreAllMocks();vi.unstubAllGlobals();});
it('refetches identical feed parameters after switching account',async()=>{
 const fetchMock=vi.fn(async()=>response({items:[row],meta:{isCapped:false}}));vi.stubGlobal('fetch',fetchMock);
 const {result,rerender}=renderHook(({resetKey})=>useNewsData({timeRange:'1d',sortMode:'hot',limit:50,resetKey}),{initialProps:{resetKey:'user:A'}});
 await act(async()=>{await result.current.onBoundsChange(bbox);});expect(fetchMock).toHaveBeenCalledTimes(1);
 rerender({resetKey:'user:B'});
 await waitFor(()=>expect(result.current.isLoading).toBe(false));
 expect(fetchMock).toHaveBeenCalledTimes(2);
});
it('discards paid detail responses arriving after guest reset',async()=>{
 let resolveDetail!:(r:Response)=>void;
 vi.stubGlobal('fetch',vi.fn((url:string)=>url==='/api/news/'+row.id?new Promise<Response>(resolve=>resolveDetail=resolve):Promise.resolve(response({items:[],meta:{}}))));
 const {result,rerender}=renderHook(({resetKey})=>useNewsData({timeRange:'1d',sortMode:'hot',resetKey,pinnedEventId:row.id}),{initialProps:{resetKey:'user:A'}});
 let pending!:Promise<void>;
 act(()=>{pending=result.current.fetchEventDetails(row.id);});
 rerender({resetKey:'guest'});
 await act(async()=>{resolveDetail(response({event:row,description:'old privileged detail',sources:[{name:'Paid source',url:'https://example.com/paid',source_type:'rss',discovered_at:row.publishedAt}],timelineRestricted:false}));await pending;});
 expect(result.current.news.some(item=>item.description==='old privileged detail')).toBe(false);
});

it('refreshes selected details even while the old detail entry is fresh', async () => {
 const fetchMock = vi.fn(async (url: string) => {
   if (url.startsWith('/api/news/' + row.id)) {
     return response({ event: row, description: url.includes('refresh=true') ? 'updated' : 'original', sources: [] });
   }
   return response({ items: [row], meta: {} });
 });
 vi.stubGlobal('fetch', fetchMock);
 const { result } = renderHook(() => useNewsData({ timeRange: '1d', sortMode: 'hot', resetKey: 'user:A:pro', pinnedEventId: row.id }));
 await act(async () => { await result.current.onBoundsChange(bbox); await result.current.fetchEventDetails(row.id); });
 expect(result.current.news[0].description).toBe('original');
 await act(async () => { await result.current.fetchNews(true); });
 expect(result.current.news[0].description).toBe('updated');
 expect(fetchMock).toHaveBeenCalledWith('/api/news/' + row.id + '?refresh=true');
});
