import React from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { ChevronDown, ChevronRight } from 'lucide-react-native';
import { Button } from '../../../components/Button';
import { Segmented } from '../../../components/Segmented';
import { Txt } from '../../../components/Text';
import { TextField } from '../../../components/TextField';
import { settingsText } from '../../../locales/settings';
import { color as c, radius } from '../../../theme/tokens';
import {
  ADVANCED_FIELDS, DEFAULT_BUDGET, advancedSummary, autoName, parseBudget, parseMaxOutput,
  type Caps, type Field, type Form,
} from './form';

const a = settingsText.advanced;
const EFFORTS = ['default', 'low', 'medium', 'high'] as const;
const CAPS = ['jsonSchema', 'effort', 'streaming'] as const;

export interface AdvancedSectionProps {
  form: Form;
  open: boolean;
  onToggle: () => void;
  errors: Partial<Record<Field, string>>;
  /** Shown capabilities: the draft caps merged with the matching test's evidence. */
  caps: Caps;
  editable: boolean;
  onChange: <K extends keyof Form>(key: K, value: Form[K]) => void;
  onBlurNumber: (field: 'maxOutput' | 'budget') => void;
  onClearCaps: () => void;
  /** 'top' is the body's y in this section; fields report y inside the body. */
  onFieldLayout: (field: Field | 'top', y: number) => void;
}

/** S02b: collapsible advanced options; every change only edits the S02 draft. */
export function AdvancedSection({
  form, open, onToggle, errors, caps, editable, onChange, onBlurNumber, onClearCaps, onFieldLayout,
}: AdvancedSectionProps) {
  const errorCount = ADVANCED_FIELDS.filter(field => errors[field]).length;
  const max = parseMaxOutput(form.maxOutput);
  const budget = parseBudget(form.budget);
  const anthropic = form.protocol === 'anthropic_messages';
  const probed = CAPS.some(cap => caps[cap] !== undefined);
  const effortHelp = caps.effort === false ? a.effortUnsupported
    : form.effort === 'default' ? a.effortDefaultHelp : a.effortHelp(a.efforts[form.effort]);
  return (
    <View style={styles.wrap}>
      <Pressable onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded: open }}
        accessibilityLabel={a.title} style={({ pressed }) => [styles.head, pressed && styles.pressed]}>
        <View style={styles.headText}>
          <Txt>{a.title}</Txt>
          {!open ? (
            <Txt variant="caption" color={errorCount ? c.conf : c.ink3} numberOfLines={1}>
              {errorCount ? a.errors(errorCount) : advancedSummary(form)}
            </Txt>
          ) : null}
        </View>
        {open ? <ChevronDown size={18} color={c.ink3} /> : <ChevronRight size={18} color={c.ink3} />}
      </Pressable>
      {open ? (
        <View style={styles.body} onLayout={e => onFieldLayout('top', e.nativeEvent.layout.y)}>
          <View onLayout={e => onFieldLayout('name', e.nativeEvent.layout.y)}>
            <TextField label={a.name} accessibilityLabel={a.name} placeholder={autoName(form.baseUrl)}
              value={form.name} onChangeText={v => onChange('name', v)} max={30} counter="near"
              error={errors.name} editable={editable} />
          </View>
          <View onLayout={e => onFieldLayout('maxOutput', e.nativeEvent.layout.y)} style={styles.field}>
            <TextField label={a.maxOutput} accessibilityLabel={a.maxOutput} placeholder={a.maxOutputPlaceholder}
              value={form.maxOutput} onChangeText={v => onChange('maxOutput', v)} keyboardType="number-pad"
              onBlur={() => onBlurNumber('maxOutput')} error={errors.maxOutput} help={a.maxOutputHelp} editable={editable} />
            {!errors.maxOutput && max != null && max < 4000 ? <Txt variant="caption" color={c.pend}>{a.maxOutputLow}</Txt> : null}
          </View>
          <View style={styles.field}>
            <Txt variant="callout" color={c.ink2}>{a.effort}</Txt>
            <Segmented value={form.effort} onChange={v => onChange('effort', v)} locked={!editable}
              segments={EFFORTS.map(key => ({ key, label: a.efforts[key] }))} />
            <Txt variant="caption" color={c.ink3}>{effortHelp}</Txt>
          </View>
          {anthropic ? (
            <View style={styles.field}>
              <Txt variant="callout" color={c.ink2}>{a.authHeader}</Txt>
              <Segmented value={form.authHeader} onChange={v => onChange('authHeader', v)} locked={!editable}
                segments={(['x-api-key', 'bearer'] as const).map(key => ({ key, label: a.authHeaders[key] }))} />
              <Txt variant="caption" color={c.ink3}>{a.authHelp}</Txt>
            </View>
          ) : (
            <View style={styles.switchRow}>
              <View style={styles.flex}>
                <Txt>{a.store}</Txt>
                <Txt variant="caption" color={c.ink3}>{form.store ? a.storeOn : a.storeOff}</Txt>
              </View>
              <Switch value={!form.store} onValueChange={on => onChange('store', !on)} disabled={!editable}
                accessibilityLabel={a.store} trackColor={{ true: c.brand, false: c.line }} />
            </View>
          )}
          <View onLayout={e => onFieldLayout('budget', e.nativeEvent.layout.y)} style={styles.field}>
            <TextField label={a.budget} accessibilityLabel={a.budget} value={form.budget}
              onChangeText={v => onChange('budget', v)} keyboardType="number-pad" onBlur={() => onBlurNumber('budget')}
              error={errors.budget} editable={editable}
              help={budget != null ? a.budgetHelp((budget / 10000).toFixed(1)) : undefined}
              accessory={budget !== DEFAULT_BUDGET ? (
                <Button label={a.budgetReset} variant="text" size="small" disabled={!editable}
                  onPress={() => onChange('budget', String(DEFAULT_BUDGET))} />
              ) : null} />
          </View>
          <View style={styles.caps}>
            <Txt variant="callout" color={c.ink2}>{a.caps}</Txt>
            {probed ? CAPS.map(cap => (
              <View key={cap} style={styles.capRow}>
                <Txt variant="callout">{a.capNames[cap]}</Txt>
                <Txt variant="callout" color={caps[cap] === false ? c.pend : c.ink3}>
                  {caps[cap] === undefined ? a.capUnknown : caps[cap] ? a.capYes : a.capNo}
                </Txt>
              </View>
            )) : <Txt variant="caption" color={c.ink3}>{a.capsEmpty}</Txt>}
            {probed ? <Button label={a.clearCaps} variant="text" size="small" disabled={!editable} onPress={onClearCaps} style={styles.start} /> : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: c.surface, borderRadius: radius.card },
  head: { minHeight: 56, paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  headText: { flex: 1, gap: 2 },
  pressed: { opacity: 0.6 },
  body: { paddingHorizontal: 16, paddingBottom: 16, gap: 20 },
  field: { gap: 8 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  flex: { flex: 1, gap: 2 },
  caps: { gap: 8 },
  capRow: { flexDirection: 'row', justifyContent: 'space-between', minHeight: 28, alignItems: 'center' },
  start: { alignSelf: 'flex-start' },
});
