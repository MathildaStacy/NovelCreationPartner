import React from 'react';
import { StyleSheet, View } from 'react-native';
import { TriangleAlert } from 'lucide-react-native';
import type {
  ChapterKind,
  ChapterState,
  VersionReason,
} from '../features/types';
import { color as c, radius } from '../theme/tokens';
import { Txt } from './Text';
import { t as strings } from '../locales/zh-CN';

/**
 * Status badges (UI §4.3): 22 high, 8 horizontal padding, caption, pill.
 * Every state has text, so colour is never the only signal (UI §2).
 */
export type BadgeTone =
  | 'proposed'
  | 'confirmed'
  | 'established'
  | 'conflict'
  | 'pending'
  | 'retired'
  | 'neutral';

const TONES: Record<
  BadgeTone,
  {
    bg: string;
    fg: string;
    border?: string;
    dashed?: boolean;
    strike?: boolean;
  }
> = {
  proposed: { bg: c.surface, fg: c.brand, border: c.brand, dashed: true },
  confirmed: { bg: c.brandTint, fg: c.brand },
  established: { bg: c.estTint, fg: c.est },
  conflict: { bg: c.confTint, fg: c.conf },
  pending: { bg: c.pendTint, fg: c.pend },
  retired: { bg: c.sunken, fg: c.ink3, strike: true },
  neutral: { bg: c.sunken, fg: c.ink2 },
};

export function Badge({
  label,
  tone = 'neutral',
  icon,
}: {
  label: string;
  tone?: BadgeTone;
  icon?: boolean;
}) {
  const t = TONES[tone];
  return (
    <View
      accessible
      accessibilityLabel={label}
      style={[
        styles.badge,
        { backgroundColor: t.bg },
        t.border
          ? [
              styles.bordered,
              { borderColor: t.border },
              t.dashed && styles.dashed,
            ]
          : null,
      ]}
    >
      {icon || tone === 'conflict' ? (
        <TriangleAlert size={12} color={t.fg} strokeWidth={2} />
      ) : null}
      <Txt
        variant="caption"
        color={t.fg}
        style={t.strike ? styles.strike : null}
        numberOfLines={1}
      >
        {label}
      </Txt>
    </View>
  );
}

const STATE_TONE: Record<ChapterState, BadgeTone> = {
  draft: 'neutral',
  finalized: 'established',
  modified: 'pending',
};
const STATE_TEXT: Record<ChapterState, string> = strings.badge.chapterState;

/** Chapter state (UI §4.3 last paragraph). Extras and drafts show their kind instead of a state (S06). */
export function ChapterBadge({
  kind,
  state,
}: {
  kind: ChapterKind;
  state: ChapterState;
}) {
  if (kind === 'extra') {
    return <Badge label={strings.badge.chapterKind.extra} tone="neutral" />;
  }
  if (kind === 'draft') {
    return <Badge label={strings.badge.chapterKind.draft} tone="neutral" />;
  }
  return <Badge label={STATE_TEXT[state]} tone={STATE_TONE[state]} />;
}

const REASON_TEXT: Record<VersionReason, string> = strings.badge.versionReason;

/** Version source (S07d): 定稿 in est colour, the rest neutral. */
export function ReasonBadge({ reason }: { reason: VersionReason }) {
  return (
    <Badge
      label={REASON_TEXT[reason]}
      tone={reason === 'finalize' ? 'established' : 'neutral'}
    />
  );
}

export const reasonLabel = (r: VersionReason) => REASON_TEXT[r];

const styles = StyleSheet.create({
  badge: {
    height: 22,
    paddingHorizontal: 8,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 3,
  },
  strike: { textDecorationLine: 'line-through' },
  bordered: { borderWidth: 1 },
  dashed: { borderStyle: 'dashed' },
});
