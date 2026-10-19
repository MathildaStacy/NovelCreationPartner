/** Installed native build metadata for offline About and copied diagnostics. */
export interface AppInfo { version:string; build:string; debug:boolean; }
let last:AppInfo|null=null;
/** Last successfully read metadata, for synchronous diagnostics (D05 copy text). */
export function cached():AppInfo|null { return last; }
/** "2.4.1（构建 42）" or 未知 — never a made-up version (S15f / D05). */
export function label(info:AppInfo|null=last):string { return info?`${info.version}（构建 ${info.build}）${info.debug?'（开发版）':''}`:'未知'; }
export async function get():Promise<AppInfo|null> {
  const info=await read(); if(info)last=info; return info;
}
async function read():Promise<AppInfo|null> {
  try {
    const raw:unknown=JSON.parse(await require('../native/NativeAppInfo').default.getInfo());
    if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
    const value=raw as Record<string,unknown>;
    if(typeof value.version!=='string'||typeof value.build!=='string'||typeof value.debug!=='boolean'||
      !/^[\w.+-]{1,80}$/.test(value.version)||!/^\d{1,20}(?:\.\d{1,20})*$/.test(value.build))return null;
    return {version:value.version,build:value.build,debug:value.debug};
  }catch{return null;}
}
