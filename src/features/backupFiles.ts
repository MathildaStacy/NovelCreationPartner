/** Feature boundary for local backup documents; screens never handle paths or encoded file contents. */
import { strToU8 } from 'fflate';
import * as files from '../files';
import { fromBase64, toBase64 } from '../files/base64';
import { nowIso } from '../utils/id';
import * as backup from './backup';
import { AppError } from './errors';
import * as works from './works';
import * as chapters from './chapters';

export async function pick(): Promise<{ name: string; inspection: backup.BackupInspection } | null> {
  const document = await files.pick();
  return document ? { name: document.name, inspection: backup.inspect(fromBase64(document.base64)) } : null;
}

/** Keep the extension and truncate by Unicode code points, including all naming suffixes in the 80-character limit. */
function exportName(stem: string, extension: string): string {
  // eslint-disable-next-line no-control-regex -- Portable document names must not contain separators or control bytes.
  const safe = stem.normalize('NFC').replace(/[\\/\u0000-\u001f\u007f:*?"<>|]/g, '-').replace(/^\.+/, '').trim() || '未命名作品';
  const points = [...safe].slice(0, 79 - extension.length);
  // App-cache files also need to fit the common 255-byte filename limit (emoji can use four bytes each).
  while (strToU8(`${points.join('')}.${extension}`).length > 255) points.pop();
  return `${points.join('')}.${extension}`;
}

export async function share(options: { format: 'backup' | 'txt' | 'md'; workId?: string; chapterIds?: string[] }): Promise<files.ShareResult> {
  if (options.format !== 'backup' && !options.workId) throw new AppError('VALIDATION', '请选择要导出的作品。');
  const now = nowIso();
  const stamp = `${now.slice(0, 10).replace(/-/g, '')}-${now.slice(11, 16).replace(':', '')}`;
  const workTitle = options.workId ? (await works.get(options.workId)).title?.trim() || '未命名作品' : '小说';
  let stem = options.format === 'backup' ? `${workTitle}${options.workId ? '-' : ''}备份-${stamp}` : workTitle;
  if (options.format !== 'backup' && options.chapterIds?.length === 1) {
    const chapter = (await chapters.list(options.workId!)).flatMap(group => group.chapters).find(row => row.id === options.chapterIds![0]);
    if (!chapter || chapter.kind === 'draft') throw new AppError('VALIDATION', '请选择本作品的正文或番外章节。');
    stem = `${workTitle}-${chapter.kind === 'main' ? `第${chapter.number}章` : '番外'}-${chapter.title}`;
  }
  const bytes = options.format === 'backup' ? await backup.build(options.workId)
    : strToU8(await backup.exportText(options.workId!, { format: options.format, chapterIds: options.chapterIds }));
  return files.writeAndShare(exportName(stem, options.format === 'backup' ? 'ncpbak' : options.format),
    toBase64(bytes), options.format === 'backup' ? 'application/zip' : options.format === 'md' ? 'text/markdown' : 'text/plain');
}
