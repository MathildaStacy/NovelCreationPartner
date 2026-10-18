/** Route map (G01 §1): shelf stack at the root, the work's four tabs, full-screen editor pages above them. */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { EntryType, ID } from '../../features/types';

export type WorkTab = 'Overview' | 'Chapters' | 'Partner' | 'Archive';

/** S07 "跳到原文" (S07 §5.7). Offsets are storage offsets. */
export type Locate = { quote?: string; offset?: number };

export type RootStackParamList = {
  /** S03 */
  Shelf: undefined;
  Welcome: undefined;
  Restore: { from: 'welcome' | 'settings' | 'shelf' };
  Export: { workId?: ID; chapterId?: ID };
  Trash: undefined;
  About: undefined;
  /** S03b */
  Search: undefined;
  /** S04 (slides up; a card, not a native modal, so toasts and dialogs stay on top) */
  NewWork: undefined;
  /** S05–S11 tabs */
  Work: { workId: ID; tab?: WorkTab; seed?: string };
  /** S05a */
  WorkInfo: { workId: ID; from: 'overview' | 'shelf' };
  Jobs: { workId: ID };
  Review: { workId: ID; chapterId?: ID; entryId?: ID };
  Conflicts: { workId: ID; chapterId?: ID; entryId?: ID };
  ConflictDetail: { conflictId: ID };
  EntryDetail: { entryId: ID };
  EntryForm: { workId: ID; entryId?: ID; type?: EntryType; name?: string; field?: string; conflictId?: ID };
  EntryHistory: { entryId: ID };
  /** S07 */
  Editor: { workId: ID; chapterId: ID; restored?: boolean; locate?: Locate; focusNonce?: number };
  /** S07d */
  Versions: { chapterId: ID; from: 'editor' | 'list' };
  /** S07e */
  VersionDiff: { chapterId: ID; versionId: ID; from: 'editor' | 'list' };
  /** S06d */
  Reorder: { workId: ID };
  /** S15 */
  Settings: undefined;
  /**
   * S02. Parameters never carry an API Key (S02 rule 5). 'guide' / 'welcome' are
   * reserved for S01, which is not routed in this phase.
   */
  ModelService: ModelServiceParams;
};

export type ModelServiceParams =
  | { mode: 'guide' | 'add'; from: ModelServiceFrom; serviceId?: undefined; focus?: undefined }
  | { mode: 'edit'; from: ModelServiceFrom; serviceId: ID; focus?: 'key' };
export type ModelServiceFrom = 'welcome' | 'd03' | 'settings' | 'error';

export type WorkTabParamList = {
  Overview: undefined;
  Chapters: undefined;
  Partner: { seed?: string } | undefined;
  Archive: { type?: EntryType } | undefined;
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
