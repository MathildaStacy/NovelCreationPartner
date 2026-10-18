import React, { useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { confirmDelete } from '../../app/dialogs';
import { showError, toAppError } from '../../app/errors';
import type { RootStackParamList } from '../../app/navigation/types';
import { ActionSheet, type ActionItem } from '../../components/ActionSheet';
import { toast } from '../../components/overlay/store';
import * as chapters from '../../features/chapters';
import * as proposals from '../../features/proposals';
import * as trash from '../../features/trash';
import type { ChapterListItem } from '../../features/types';
import { t } from '../../locales/zh-CN';
import { chapterHeading, formatChars, STATE_LABEL } from '../../utils/format';
import { finalizeWithConfirm } from '../editor/finalize';
import type { ChapterGroup } from './chapterLayout';

/** D02 shared by S06 swipe-delete and S06b. */
export async function removeChapter(
  chapter: ChapterListItem,
): Promise<boolean> {
  try {
    const pending = await proposals.pendingCount(chapter.id);
    const deleted = await confirmDelete({
      name: chapterHeading(chapter),
      body: t.confirmDelete.chapterBody,
      notes: pending ? [t.confirmDelete.chapterPending(pending)] : undefined,
      button: t.confirmDelete.chapterButton,
      run: () => chapters.remove(chapter.id),
    });
    if (deleted) {
      toast(t.common.movedToTrash, {
        action: {
          label: t.common.undo,
          onPress: () => {
            trash.restore('chapter', chapter.id).catch(e => showError(e));
          },
        },
      });
    }
    return deleted;
  } catch (e) {
    showError(e);
    return false;
  }
}

export function chapterActionItems(
  chapter: ChapterListItem,
  volumeCount: number,
): ActionItem[] {
  const items: ActionItem[] = [
    { key: 'info', label: t.chapterActions.editInfo },
  ];
  if (volumeCount > 1) {
    items.push({ key: 'move', label: t.chapterActions.move });
  }
  if (chapter.kind === 'main') {
    if (chapter.state !== 'finalized') {
      items.push({ key: 'finalize', label: t.chapterActions.finalize });
    }
    if (chapter.state !== 'draft') {
      items.push({ key: 'unfinalize', label: t.chapterActions.unfinalize });
    }
  }
  items.push({ key: 'versions', label: t.chapterActions.versions });
  if (chapter.kind !== 'draft') {
    items.push({ key: 'export', label: t.chapterActions.export });
  }
  items.push({
    key: 'remove',
    label: t.chapterActions.remove,
    accessibilityLabel: t.chapterActions.removeA11y,
  });
  return items;
}

/** S06b uses the row already loaded by S06. Follow-up sheets open only after the menu has closed. */
export function ChapterActionsSheet({
  chapter,
  groups,
  visible,
  onRequestClose,
  onEdit,
  onDone,
}: {
  chapter: ChapterListItem | null;
  groups: ChapterGroup[];
  visible: boolean;
  onRequestClose: () => void;
  onEdit: (chapterId: string) => void;
  onDone: () => void;
}) {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [moveVisible, setMoveVisible] = useState(false);
  const [moving, setMoving] = useState<ChapterListItem | null>(null);
  const run = async (key: string | null) => {
    if (!chapter) {
      onDone();
      return;
    }
    if (key === 'move') {
      setMoving(chapter);
      setMoveVisible(true);
      return;
    }
    onDone();
    try {
      switch (key) {
        case 'info':
          onEdit(chapter.id);
          return;
        case 'finalize':
          if (!chapter.charCount) {
            toast(t.chapterActions.emptyBody);
            return;
          }
          await finalizeWithConfirm(chapter);
          return;
        case 'unfinalize':
          await chapters.unfinalize(chapter.id);
          toast(t.chapterActions.unfinalized);
          return;
        case 'versions':
          navigation.navigate('Versions', {
            chapterId: chapter.id,
            from: 'list',
          });
          return;
        case 'export':
          navigation.navigate('Export', { workId: chapter.workId, chapterId: chapter.id });
          return;
        case 'remove':
          await removeChapter(chapter);
          return;
      }
    } catch (e) {
      showError(e);
    }
  };
  return (
    <>
      <ActionSheet
        visible={visible}
        title={
          chapter
            ? [
                chapterHeading(chapter),
                chapter.kind === 'main' ? STATE_LABEL[chapter.state] : '',
                formatChars(chapter.charCount),
              ]
                .filter(Boolean)
                .join(' · ')
            : ''
        }
        items={chapter ? chapterActionItems(chapter, groups.length) : []}
        onRequestClose={onRequestClose}
        onDone={run}
      />
      {moving ? (
        <ActionSheet
          visible={moveVisible}
          title={t.chapterActions.pickVolume}
          items={groups.map(g => ({
            key: g.volume.id,
            label: `${g.volume.title}${
              g.volume.id === moving.volumeId ? t.chapterActions.current : ''
            }`,
            disabled: g.volume.id === moving.volumeId,
          }))}
          onRequestClose={() => setMoveVisible(false)}
          onDone={async id => {
            const target = moving;
            setMoving(null);
            onDone();
            if (!id) {
              return;
            }
            try {
              await chapters.update(target.id, { volumeId: id });
              toast(
                t.chapterActions.moved(
                  groups.find(g => g.volume.id === id)?.volume.title ?? '',
                ),
              );
            } catch (e) {
              if (toAppError(e).code === 'NOT_FOUND') {
                toast(t.errors.chapterGone);
              } else {
                showError(e);
              }
            }
          }}
        />
      ) : null}
    </>
  );
}
