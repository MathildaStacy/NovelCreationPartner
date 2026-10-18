import React from 'react';
import { StyleSheet, View } from 'react-native';
import { EmptyState } from '../../components/EmptyState';
import { NavBar } from '../../components/NavBar';
import type { WorkTabScreenProps } from '../../app/navigation/types';
import { t } from '../../locales/zh-CN';

/** S10 AI 伙伴 — placeholder until the AI runtime (G03) lands. */
export function PartnerPlaceholder({ navigation }: WorkTabScreenProps<'Partner'>) {
  return (
    <View style={styles.root}>
      <NavBar title={t.placeholder.partnerTitle} backLabel={t.tabs.backToShelf} onBack={() => navigation.popTo('Shelf')} />
      <EmptyState title={t.placeholder.partnerTitle} message={t.placeholder.partnerBody} style={styles.body} />
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 }, body: { flex: 1 } });
