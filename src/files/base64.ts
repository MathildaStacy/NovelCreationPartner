/* eslint-disable no-bitwise -- Base64 maps binary octets into six-bit groups. */
/** RN/Hermes-safe binary codec; no Node Buffer dependency. */
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function toBase64(bytes:Uint8Array):string {
  const parts:string[]=[];
  for(let i=0;i<bytes.length;i+=3){const a=bytes[i],b=bytes[i+1],c=bytes[i+2];parts.push(alphabet[a>>2]+alphabet[((a&3)<<4)|((b??0)>>4)]+(b===undefined?'=':alphabet[((b&15)<<2)|((c??0)>>6)])+(c===undefined?'=':alphabet[c&63]));}
  return parts.join('');
}
export function fromBase64(text:string):Uint8Array {
  if(text.length%4!==0)throw new Error('Invalid base64');
  const padding=text.endsWith('==')?2:text.endsWith('=')?1:0;
  for(let i=0;i<text.length-padding;i++)if(alphabet.indexOf(text[i])<0)throw new Error('Invalid base64');
  if(text.slice(text.length-padding)!=='='.repeat(padding))throw new Error('Invalid base64');
  const result=new Uint8Array(text.length/4*3-(text.endsWith('==')?2:text.endsWith('=')?1:0));let n=0;
  for(let i=0;i<text.length;i+=4){const a=alphabet.indexOf(text[i]),b=alphabet.indexOf(text[i+1]),c=alphabet.indexOf(text[i+2]),d=alphabet.indexOf(text[i+3]);result[n++]=(a<<2)|(b>>4);if(n<result.length)result[n++]=((b&15)<<4)|(c>>2);if(n<result.length)result[n++]=((c&3)<<6)|d;}
  return result;
}
