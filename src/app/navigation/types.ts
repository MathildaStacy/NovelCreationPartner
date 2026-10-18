/** Route map (G01 §1): shelf stack at the root, the work's four tabs, full-screen editor pages above them. */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { ID } from '../../features/types';

export type WorkTab = 'Overview' | 'Chapters' | 'Partner' | 'Archive';

/** S07 "跳到原文" (S07 §5.7). Offsets are storage offsets. */
export type Locate = { quote?: string; offset?: number };

export type RootStackParamList = {
  /** S03 */
  Shelf: undefined;
  /** S03b */
  Search: undefined;
  /** S04 (slides up; a card, not a native modal, so toasts and dialogs stay on top) */
  NewWork: undefined;
  /** S05–S11 tabs */
  Work: { workId: ID; tab?: WorkTab };
  /** S05a */
  WorkInfo: { workId: ID; from: 'overview' | 'shelf' };
  /** S07 */
  Editor: { workId: ID; chapterId: ID; restored?: boolean; locate?: Locate; focusNonce?: number };
  /** S07d */
  Versions: { chapterId: ID; from: 'editor' | 'list' };
  /** S07e */
  VersionDiff: { chapterId: ID; versionId: ID; from: 'editor' | 'list' };
  /** S06d */
  Reorder: { workId: ID };
};

export type WorkTabParamList = {
  Overview: undefined;
  Chapters: undefined;
  Partner: undefined;
  Archive: undefined;
};

export type RootScreenProps<K extends keyof RootStackParamList> = NativeStackScreenProps<RootStackParamList, K>;

export type WorkTabScreenProps<K extends keyof WorkTabParamList> = CompositeScreenProps<
  BottomTabScreenProps<WorkTabParamList, K>,
  NativeStackScreenProps<RootStackParamList>
>;

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
