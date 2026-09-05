import {it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({parse:vi.fn().mockRejectedValue(new Error('XML parse failed'))}));
vi.mock('rss-parser',()=>({default:class{parseString=mocks.parse;}}));
vi.mock('@/lib/security/feedFetch',()=>({fetchBoundedFeed:async()=>({notModified:false,text:'<bad>',etag:'new-etag'})}));
import {fetchSingleFeed} from '@/lib/api/rss';
it('does not stage validators for malformed XML',async()=>{
 const onValidator=vi.fn();
 expect(await fetchSingleFeed({name:'Audit',url:'https://example.com/rss',category:'world',credibility_tier:1},100,{onValidator})).toEqual([]);
 expect(onValidator).not.toHaveBeenCalled();
});
