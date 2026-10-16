/**
 * 设置页面
 */

import React from 'react';
import {View, Text, StyleSheet, StatusBar, TouchableOpacity, ScrollView} from 'react-native';
import {colors, theme} from '../../constants';

export const SettingsScreen = () => {
  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      <View style={styles.header}>
        <Text style={styles.headerTitle}>设置</Text>
      </View>

      <ScrollView style={styles.content}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>通用</Text>
          <TouchableOpacity style={styles.item}>
            <Text style={styles.itemLabel}>账号设置</Text>
            <Text style={styles.itemValue}>→</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.item}>
            <Text style={styles.itemLabel}>主题设置</Text>
            <Text style={styles.itemValue}>深色模式</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>关于</Text>
          <View style={styles.item}>
            <Text style={styles.itemLabel}>版本</Text>
            <Text style={styles.itemValue}>0.1.1</Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.base,
  },
  header: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    backgroundColor: colors.background.layer1,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
  },
  headerTitle: {
    fontSize: theme.fontSizes['2xl'],
    fontWeight: theme.fontWeights.bold,
    color: colors.text.primary,
  },
  content: {
    flex: 1,
  },
  section: {
    marginTop: theme.spacing.lg,
    paddingHorizontal: theme.spacing.md,
  },
  sectionTitle: {
    fontSize: theme.fontSizes.sm,
    fontWeight: theme.fontWeights.semibold,
    color: colors.text.tertiary,
    marginBottom: theme.spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  item: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.background.layer2,
    padding: theme.spacing.md,
    borderRadius: theme.radii.lg,
    marginBottom: theme.spacing.sm,
  },
  itemLabel: {
    fontSize: theme.fontSizes.md,
    color: colors.text.primary,
  },
  itemValue: {
    fontSize: theme.fontSizes.md,
    color: colors.text.secondary,
  },
});
