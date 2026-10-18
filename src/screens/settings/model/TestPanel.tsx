import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button } from '../../../components/Button';
import { Txt } from '../../../components/Text';
import type { TestResult } from '../../../features/modelServices';
import type { AiErrorInfo } from '../../../features/types';
import { settingsText } from '../../../locales/settings';
import { t } from '../../../locales/zh-CN';
import { color as c, radius } from '../../../theme/tokens';
import { resultFailure, seconds, type Failure, type FixTarget } from './form';

const s = settingsText.test;

export type TestState =
  | { kind: 'none' }
  | { kind: 'running'; started: number; host: string; retry: 1 | 2 | null }
  | { kind: 'done'; result: TestResult; model: string }
  /** A local failure (KEY_UNAVAILABLE) without AI error information. */
  | { kind: 'local'; failure: Failure };

export interface TestPanelProps {
  state: TestState;
  onCancel: () => void;
  onFix: (target: FixTarget) => void;
  onDetail: (info: AiErrorInfo) => void;
  onPick: () => void;
}

const FIX_LABEL: Record<FixTarget, string> = s.fixes;

function fixLabel(failure: Failure): string | null {
  return failure.fix ? FIX_LABEL[failure.fix] : null;
}

/** S02c result area under the 测试连接 button. */
export function TestPanel({ state, onCancel, onFix, onDetail, onPick }: TestPanelProps) {
  if (state.kind === 'none') { return null; }
  if (state.kind === 'running') { return <Running state={state} onCancel={onCancel} />; }
  const failure = state.kind === 'local' ? state.failure : resultFailure(state.result);
  if (state.kind === 'done' && !failure) {
    const r = state.result;
    const third = `${r.modelCount === null ? s.noModelList : s.modelCount(r.modelCount)}，${
      r.streaming === true ? s.streamingYes : r.streaming === false ? s.streamingNo : s.streamingUnknown}`;
    return (
      <View style={[styles.box, styles.ok]} accessibilityLiveRegion="polite">
        <Txt weight="600" color={c.est}>{s.okTitle}</Txt>
        <Txt variant="callout" color={c.ink2}>{s.okLine(seconds(r.latencyMs), r.responseModel ?? state.model)}</Txt>
        <Txt variant="callout" color={c.ink2}>{third}</Txt>
        {r.latencyMs > 10000 ? <Txt variant="callout" color={c.pend}>{s.slow}</Txt> : null}
        {r.modelListed === false ? (
          <View style={styles.inline}>
            <Txt variant="callout" color={c.pend}>{s.unlisted(state.model)}</Txt>
            <Button label={settingsText.form.pick} variant="text" size="small" onPress={onPick} style={styles.start} />
          </View>
        ) : null}
      </View>
    );
  }
  const f = failure!;
  const fix = fixLabel(f);
  return (
    <View style={[styles.box, styles.fail]} accessibilityLiveRegion="polite">
      <Txt weight="600" color={c.conf}>{f.title}</Txt>
      <Txt variant="callout" color={c.ink2}>{f.message}</Txt>
      {fix || f.info ? (
        <View style={styles.actions}>
          {fix ? <Button label={fix} variant="text" size="small" onPress={() => onFix(f.fix!)} /> : null}
          {f.info ? <Button label={t.common.viewDetail} variant="text" size="small" onPress={() => onDetail(f.info!)} /> : null}
        </View>
      ) : null}
    </View>
  );
}

function Running({ state, onCancel }: { state: Extract<TestState, { kind: 'running' }>; onCancel: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const elapsed = Math.max(0, Math.floor((now - state.started) / 1000));
  return (
    <View style={[styles.box, styles.running]}>
      <Txt weight="600">{s.runningTitle}</Txt>
      <Txt variant="callout" color={c.ink2}>{state.retry ? s.retrying(state.retry) : s.elapsed(state.host, elapsed)}</Txt>
      <Button label={s.cancel} variant="text" size="small" onPress={onCancel} style={styles.end} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderRadius: radius.card, padding: 14, gap: 4, backgroundColor: c.surface },
  running: { borderColor: c.line },
  ok: { borderColor: c.est },
  fail: { borderColor: c.conf },
  inline: { gap: 2, marginTop: 4 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4, marginLeft: -8 },
  start: { alignSelf: 'flex-start', marginLeft: -8 },
  end: { alignSelf: 'flex-end' },
});
