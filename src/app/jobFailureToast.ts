/** S05b entry: a background job that fails shows a toast with "查看" from any page (G01 提示条). */
import type { NavigationContainerRef } from '@react-navigation/native';
import { toast } from '../components/overlay/store';
import * as chapters from '../features/chapters';
import { on } from '../features/events';
import type { RootStackParamList } from './navigation/types';

export function watchJobFailures(navigation: Pick<NavigationContainerRef<RootStackParamList>, 'isReady' | 'getCurrentRoute' | 'navigate'>): () => void {
  return on('jobs.failed', async ({ workId, chapterId }) => {
    const route = navigation.isReady() ? navigation.getCurrentRoute() : undefined;
    // S05b already lists the failure; no toast on top of it.
    if (route?.name === 'Jobs' && (route.params as { workId?: string } | undefined)?.workId === workId) { return; }
    const chapter = chapterId ? await chapters.get(chapterId).catch(() => null) : null;
    const where = chapter?.number != null ? `第 ${chapter.number} 章的` : chapter?.kind === 'extra' ? '番外的' : '';
    toast(`${where}定稿整理没有完成`, { duration: 5000, action: { label: '查看', onPress: () => { if (navigation.isReady()) { navigation.navigate('Jobs', { workId }); } } } });
  });
}
