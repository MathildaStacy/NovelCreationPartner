/** Whole paragraphs remain intact. Offsets always refer to the bound full version. */
import { countChars } from '../../utils/text';
export interface Paragraph { text:string; offset:number; }
export interface AnalysisChunk { text:string; offset:number; paragraphIndexes:number[]; }
export const CHUNK_CHARACTERS=9000;
export function paragraphs(body:string):Paragraph[] {
  const result:Paragraph[]=[];const expression=/[^\n]*(?:\n|$)/g;let match:RegExpExecArray|null;
  while((match=expression.exec(body))&&match[0])result.push({text:match[0],offset:match.index});
  return result;
}
/** Multiset paragraph matching handles insertion/deletion without comparing shifted positions. */
export function changedParagraphs(body:string,baseline:string|null):Set<number> {
  const current=paragraphs(body);if(baseline===null)return new Set(current.map((_,i)=>i));
  const available=new Map<string,number>();for(const p of paragraphs(baseline))available.set(p.text,(available.get(p.text)??0)+1);
  const changed=new Set<number>();current.forEach((p,i)=>{const n=available.get(p.text)??0;if(n)available.set(p.text,n-1);else changed.add(i);});
  const oldParagraphs=paragraphs(baseline);
  // A pure reorder changes narrative context even when the paragraph multiset is identical.
  if(!changed.size&&current.length===oldParagraphs.length&&current.some((p,i)=>p.text!==oldParagraphs[i].text))return new Set(current.map((_,i)=>i));
  // Pure deletion also analyzes the surviving border, rather than treating it as no change.
  const removed=[...available.values()].some(n=>n>0);
  if(removed) {
    const old=oldParagraphs;let prefix=0;while(prefix<Math.min(old.length,current.length)&&old[prefix].text===current[prefix].text)prefix++;
    if(current.length)changed.add(Math.min(prefix,current.length-1));
  }
  for(const i of [...changed]){if(i)changed.add(i-1);if(i+1<current.length)changed.add(i+1);}
  return changed;
}
export function splitAnalysisChunks(body:string,selected?:ReadonlySet<number>):AnalysisChunk[] {
  const source=paragraphs(body),result:AnalysisChunk[]=[];let current:AnalysisChunk|null=null;
  source.forEach((p,i)=>{
    if(selected&&!selected.has(i))return;
    if(!current||current.paragraphIndexes.at(-1)!==i-1||countChars(current.text)+countChars(p.text)>CHUNK_CHARACTERS){
      current={text:p.text,offset:p.offset,paragraphIndexes:[i]};result.push(current);
    }else{current.text+=p.text;current.paragraphIndexes.push(i);}
  });
  return result;
}
