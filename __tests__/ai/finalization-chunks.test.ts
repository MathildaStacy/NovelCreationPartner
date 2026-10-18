import { changedParagraphs,paragraphs,splitAnalysisChunks } from '../../src/ai/tasks/finalizationChunks';
test('paragraph splitting preserves every character and UTF16 evidence offset without slicing long sentences',()=>{
  const body=`首段😀。\n${'长'.repeat(10000)}。\n尾段。`;
  const chunks=splitAnalysisChunks(body);
  expect(chunks.map(c=>c.text).join('')).toBe(body);
  for(const chunk of chunks)expect(body.slice(chunk.offset,chunk.offset+chunk.text.length)).toBe(chunk.text);
  expect(chunks[1].text.length).toBeGreaterThan(9000);
  expect(paragraphs(body)[1].offset).toBe('首段😀。\n'.length);
});
test('incremental paragraph selection includes neighbors and a pure-deletion border',()=>{
  expect([...changedParagraphs('一\n二\n新三\n四\n五','一\n二\n三\n四\n五')].sort()).toEqual([1,2,3]);
  expect([...changedParagraphs('一\n三\n四','一\n二\n三\n四')].sort()).toEqual([0,1,2]);
  expect([...changedParagraphs('一\n三\n二\n四','一\n二\n三\n四')].sort()).toEqual([0,1,2,3]);
});
