import { ProtocolParser, parseJsonResponseWithEvidence } from '../../src/ai/providers/parse';
import type { ErrorContext } from '../../src/ai/providers/errors';
import { createProvider, type AttemptEvidence } from '../../src/ai/providers/httpProvider';
import type { HttpTransport } from '../../src/ai/transport/native';
import { DEFAULT_OPTIONS } from '../../src/features/modelServiceConfig';
import type { Usage } from '../../src/ai/providers/types';
import { db, setDb } from '../../src/data/db';
import { freshDb } from '../helpers/db';
import * as ledger from '../../src/features/aiUsage';
const context:ErrorContext={protocol:'openai_responses',serviceName:'fixture',model:'fixture',baseUrl:'https://example.test'};
const frame=(type:string,value:object)=>({event:type,data:JSON.stringify({type,...value})});
test('OpenAI cache and reasoning counts remain subsets of cumulative totals',()=>{
  const parsed=parseJsonResponseWithEvidence('openai_responses',{status:'completed',output:[],usage:{input_tokens:100,output_tokens:40,input_tokens_details:{cached_tokens:80},output_tokens_details:{reasoning_tokens:30}}},context);
  expect(parsed.usage).toEqual({input:100,output:40,cachedInput:80,reasoningOutput:30});
  const parser=new ProtocolParser('openai_responses',context);
  parser.push(frame('response.usage',{usage:{input_tokens:100,output_tokens:10,input_tokens_details:{cached_tokens:80},output_tokens_details:{reasoning_tokens:9}}}));
  const done=parser.push(frame('response.completed',{response:{status:'completed',output:[],usage:{input_tokens:100,output_tokens:40}}}));
  expect(done).toMatchObject([{usage:{input:100,output:40}}]);
  expect(parser.usage).toEqual({input:100,output:40});
});
test('Anthropic ordinary, cache read and cache write input buckets are added once; omitted buckets stay unknown',()=>{
  const ctx={...context,protocol:'anthropic_messages' as const};
  const parser=new ProtocolParser('anthropic_messages',ctx);
  parser.push(frame('message_start',{message:{type:'message',content:[],usage:{input_tokens:10,output_tokens:1,cache_read_input_tokens:80,cache_creation_input_tokens:20}}}));
  parser.push(frame('message_delta',{delta:{stop_reason:'end_turn'},usage:{output_tokens:5}}));
  expect(parser.push(frame('message_stop',{}))).toMatchObject([{usage:{input:110,output:5,cachedInput:80,cacheWriteInput:20,uncachedInput:10}}]);
  const missing=parseJsonResponseWithEvidence('anthropic_messages',{type:'message',content:[],stop_reason:'end_turn',usage:{input_tokens:10,output_tokens:5,cache_read_input_tokens:80}},ctx);
  expect(missing.usage).toEqual({input:10,output:5,cachedInput:80,uncachedInput:10,incompleteInputTotal:true});
});
test('a failed physical stream retains its last reported usage without exposing raw provider data',async()=>{
  const transport:HttpTransport=async function*(){
    yield {type:'headers',status:200,headers:{'content-type':'text/event-stream'}};
    const text='event: response.usage\ndata: '+JSON.stringify({type:'response.usage',usage:{input_tokens:21,output_tokens:3,input_tokens_details:{cached_tokens:10}}})+'\n\n'+
      'event: error\ndata: '+JSON.stringify({type:'error',error:{code:'server_error',message:'private body'}})+'\n\n';
    yield {type:'data',text,bytes:text.length};
  };
  const evidence:AttemptEvidence={streaming:null,failure:null};
  const provider=createProvider({...context,protocol:'openai_responses',options:DEFAULT_OPTIONS,name:'fixture'},'secret',{transport,evidence});
  const events=[];for await(const e of provider.generate({system:'',messages:[],maxOutputTokens:100,stream:true,signal:new AbortController().signal}))events.push(e);
  expect(events).toMatchObject([{type:'error'}]);expect(evidence.usage).toEqual({input:21,output:3,cachedInput:10});
  expect(JSON.stringify(evidence)).not.toContain('private body');
});
test('ledger stores nullable subsets once and leaves an incomplete input total unknown',async()=>{
  await freshDb();
  const operation=await ledger.connectionTestLedger({id:'fixture',revision:1,model:'fixture'});
  const a=await operation.begin(1);
  const usage:Usage={input:10,output:5,cachedInput:80,uncachedInput:10,incompleteInputTotal:true};
  await operation.end(a,{status:'failed',usage,errorCode:'AI_SERVER'});
  await operation.end(a,{status:'succeeded',usage:{input:1,output:1},errorCode:null});
  expect(await db().get('SELECT actual_input,actual_output,cached_input,cache_write_input,uncached_input,cost FROM ai_attempts')).toEqual({actual_input:null,actual_output:5,cached_input:80,cache_write_input:null,uncached_input:10,cost:null});
  expect(await ledger.summary()).toMatchObject({input:0,output:5,unknown:1,cost:null});
  await db().close();setDb(null);
});
