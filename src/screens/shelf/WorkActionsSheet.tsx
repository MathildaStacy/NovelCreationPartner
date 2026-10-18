import React from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ActionSheet, type ActionItem } from '../../components/ActionSheet';
import { toast } from '../../components/overlay/store';
import { confirmDelete } from '../../app/dialogs';
import { logError, showError } from '../../app/errors';
import type { RootStackParamList } from '../../app/navigation/types';
import * as chapters from '../../features/chapters';
import * as trash from '../../features/trash';
import type { WorkSummary } from '../../features/types';
import * as works from '../../features/works';
import { t } from '../../locales/zh-CN';
import { truncate } from '../../utils/format';
import { workMenuMeta, workName } from './workText';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/** Opens a work (S03 #4): touch without waiting, then the overview tab. */
export function openWork(navigation: { navigate: Nav['navigate'] }, workId: string) {
  works.touch(workId).catch(logError('works.touch'));
  navigation.navigate('Work', { workId });
}

/**
 * S03a 作品操作菜单. Fixed order: 打开、编辑作品信息、更换封面、标记状态、导出、删除.
 * Uses the WorkSummary the shelf already has; no query on open.
 */
export function WorkActionsSheet({
  work,
  visible,
  onRequestClose,
  onDone,
}: {
  work: WorkSummary | null;
  visible: boolean;
  onRequestClose: () => void;
  /** After the sheet closed (and any action started). */
  onDone?: () => void;
}) {
  const navigation = useNavigation<Nav>();
  if (!work) {
    return null;
  }
  const finished = work.status === 'finished';
  const items: ActionItem[] = [
    { key: 'open', label: t.workActions.open },
    { key: 'info', label: t.workActions.editInfo },
    { key: 'cover', label: t.workActions.changeCover },
    { key: 'status', label: finished ? t.workActions.markOngoing : t.workActions.markFinished },
    { key: 'export', label: t.workActions.export },
    { key: 'remove', label: t.workActions.remove, accessibilityLabel: t.workActions.removeA11y },
  ];

  const run = async (key: string | null) => {
    onDone?.();
    switch (key) {
      case 'open':
        openWork(navigation, work.id);
        return;
      case 'info':
        navigation.navigate('WorkInfo', { workId: work.id, from: 'shelf' });
        return;
      case 'cover':
      case 'export':
        // D06 image covers and S15b export come in a later phase.
        toast(t.common.comingSoon);
        return;
      case 'status':
        await setStatus(work.id, finished ? 'ongoing' : 'finished', work.status);
        return;
      case 'remove':
        await removeWork(work);
        return;
    }
  };

  return (
    <ActionSheet
      visible={visible}
      title={truncate(`${truncate(workName(work), 12)} · ${workMenuMeta(work)}`, 40)}
      items={items}
      onRequestClose={onRequestClose}
      onDone={run}
    />
  );
}

async function setStatus(id: string, next: 'ongoing' | 'finished', prev: 'ongoing' | 'finished') {
  try {
    await works.update(id, { status: next });
    toast(next === 'finished' ? t.workActions.markedFinished : t.workActions.markedOngoing, {
      action: {
        label: t.common.undo,
        onPress: () =>
          works
            .update(id, { status: prev })
            .then(() => toast(t.common.undone))
            .catch(e => showError(e)),
      },
    });
  } catch (e) {
    showError(e);
  }
}

/** D02 for a work, then a toast with 撤销 (trash.restore). Used by S03a and S05a. */
export async function removeWork(work: { id: string; title: string | null }): Promise<boolean> {
  try {
    const groups = await chapters.list(work.id);
    const n = groups.reduce((s, g) => s + g.chapters.length, 0);
    const deleted = await confirmDelete({
      name: work.title,
      untitled: t.confirmDelete.workUntitled,
      body: t.confirmDelete.workBody(n),
      button: t.confirmDelete.workButton,
      run: () => works.remove(work.id),
    });
    if (deleted) {
      toast(t.common.movedToTrash, {
        action: {
          label: t.common.undo,
          onPress: () => trash.restore('work', work.id).catch(e => showError(e)),
        },
      });
    }
    return deleted;
  } catch (e) {
    showError(e);
    return false;
  }
}
