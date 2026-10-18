/** Installed native build metadata for offline About and copied diagnostics. */
export interface AppInfo { version:string; build:string; debug:boolean; }
export async function get():Promise<AppInfo|null> {
  try {
    const raw:unknown=JSON.parse(await require('../native/NativeAppInfo').default.getInfo());
    if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
    const value=raw as Record<string,unknown>;
    if(typeof value.version!=='string'||typeof value.build!=='string'||typeof value.debug!=='boolean'||
      !/^[\w.+-]{1,80}$/.test(value.version)||!/^\d{1,20}(?:\.\d{1,20})*$/.test(value.build))return null;
    return {version:value.version,build:value.build,debug:value.debug};
  }catch{return null;}
}
