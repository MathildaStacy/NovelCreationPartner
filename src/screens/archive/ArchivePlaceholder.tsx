import React from 'react';
import { StyleSheet, View } from 'react-native';
import { EmptyState } from '../../components/EmptyState';
import { NavBar } from '../../components/NavBar';
import type { WorkTabScreenProps } from '../../app/navigation/types';
import { t } from '../../locales/zh-CN';

/** S11 档案 — placeholder until the archive services (G02 §5.5) land. */
export function ArchivePlaceholder({ navigation }: WorkTabScreenProps<'Archive'>) {
  return (
    <View style={styles.root}>
      <NavBar title={t.placeholder.archiveTitle} backLabel={t.tabs.backToShelf} onBack={() => navigation.popTo('Shelf')} />
      <EmptyState title={t.placeholder.archiveTitle} message={t.placeholder.archiveBody} style={styles.body} />
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 }, body: { flex: 1 } });
