import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { usePreventRemove } from '@react-navigation/native';
import { useLoad } from '../../app/hooks';
import { showError, showErrorDetail, toAppError } from '../../app/errors';
import { showDialog, toast } from '../../components/overlay/store';
import { Button } from '../../components/Button';
import { Chip } from '../../components/Chip';
import { Sheet } from '../../components/Sheet';
import { Txt } from '../../components/Text';
import * as works from '../../features/works';
import * as chapters from '../../features/chapters';
import * as documents from '../../features/backupFiles';

export function ExportSheet({visible,onClose,initialWorkId,initialChapterIds}:{visible:boolean;onClose():void;initialWorkId?:string;initialChapterIds?:string[]}){
  const loaded=useLoad(()=>works.list(),[visible]);
  const [workId,setWorkId]=useState<string|null>(initialWorkId??null);
  const [busy,setBusy]=useState(false);
  const [includeExtras,setIncludeExtras]=useState(false);
  const [selected,setSelected]=useState<string[]|null>(initialChapterIds??null);
  const busyRef=useRef(false);
  const selectionWorkRef=useRef(workId);
  const chapterList=useLoad(async()=>workId?(await chapters.list(workId)).flatMap(group=>group.chapters).filter(chapter=>chapter.kind!=='draft'):[],[workId,visible]);
  usePreventRemove(busy,()=>{});
  useEffect(()=>{if(selectionWorkRef.current!==workId){selectionWorkRef.current=workId;setSelected(null);setIncludeExtras(false);}},[workId]);
  const textChapters=(chapterList.data??[]).filter(chapter=>selected?selected.includes(chapter.id):includeExtras||chapter.kind==='main');
  const run=async(format:'backup'|'txt'|'md')=>{if(busyRef.current)return;busyRef.current=true;setBusy(true);try{
    const result=await documents.share({format,workId:workId??undefined,chapterIds:format==='backup'?undefined:textChapters.map(chapter=>chapter.id)});
    if(result==='completed')toast('已导出');
    else if(result==='opened')toast('已打开系统分享');
  }catch(error){
    const err=toAppError(error);
    if(err.code==='STORAGE_FULL'||err.code==='DB_ERROR'){
      const summary=err.code==='STORAGE_FULL'?'手机存储空间不足，没有生成导出文件。请清理空间后重试。':err.message==='没有打开分享面板，请重试'?err.message:'导出失败，请重试';
      const action=await showDialog({title:'导出没有成功',message:summary,buttons:[...(err.code==='DB_ERROR'?[{key:'detail',label:'查看详情'}]:[]),{key:'close',label:'知道了',style:'primary'}],dismissKey:'close'});
      if(action==='detail')await showErrorDetail(err,summary);
    }else await showError(err);
  }finally{busyRef.current=false;setBusy(false);}};
  return <Sheet visible={visible} onRequestClose={()=>{if(!busyRef.current)onClose();}} locked={busy} title="导出与备份"><ScrollView contentContainerStyle={styles.content}>
    <Txt>完整备份保留本地正文、版本和档案，不包含 API Key、请求账本或缓存。导出后可选择保存到文件或分享。</Txt>
    <View style={styles.row}><Chip label="全部作品" selected={!workId} disabled={busy} onPress={()=>setWorkId(null)}/>{loaded.data?.map(w=><Chip key={w.id} label={w.title??'未命名作品'} selected={workId===w.id} disabled={busy} onPress={()=>setWorkId(w.id)}/>)}</View>
    <Button label="导出完整备份" loading={busy} disabled={busy||!loaded.data?.length} onPress={()=>{run('backup');}}/>
    {loaded.data&&!loaded.data.length?<Txt>还没有可导出的作品</Txt>:null}
    {workId?<><Txt>正文范围：{textChapters.length} 章</Txt><View style={styles.row}>
      <Chip label="全部正文章节" selected={selected===null} disabled={busy} onPress={()=>setSelected(null)}/>
      <Chip label="选择章节" selected={selected!==null} disabled={busy} onPress={()=>setSelected(textChapters.map(chapter=>chapter.id))}/>
      {(chapterList.data??[]).some(chapter=>chapter.kind==='extra')&&selected===null?<Chip label="包含番外" selected={includeExtras} disabled={busy} onPress={()=>setIncludeExtras(value=>!value)}/>:null}
    </View>{selected!==null?<View style={styles.row}>{chapterList.data?.map(chapter=><Chip key={chapter.id} label={chapter.title} selected={selected.includes(chapter.id)} disabled={busy}
      onPress={()=>setSelected(ids=>ids?.includes(chapter.id)?ids.filter(id=>id!==chapter.id):[...(ids??[]),chapter.id])}/>)}</View>:null}
    {!textChapters.length?<Txt>请选择至少一章正文或番外</Txt>:null}</>:null}
    <Button label="导出 TXT 正文" disabled={!workId||busy||!textChapters.length} onPress={()=>{run('txt');}}/>
    <Button label="导出 Markdown 正文" disabled={!workId||busy||!textChapters.length} onPress={()=>{run('md');}}/>
    <Txt variant="caption">正文导出请选择一部作品。完整备份包含图片封面；API Key 需要在恢复后重新填写。</Txt>
  </ScrollView></Sheet>;
}

const styles=StyleSheet.create({content:{padding:20,gap:16},row:{flexDirection:'row',flexWrap:'wrap',gap:8}});
