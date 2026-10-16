/**
 * 项目详情页
 */

import React from 'react';
import {View, Text, StyleSheet, StatusBar, TouchableOpacity} from 'react-native';
import {useNavigation, useRoute} from '@react-navigation/native';
import {RootStackNavigationProp, ProjectDetailRouteProp} from '../../navigation/types';
import {colors, theme} from '../../constants';

export const ProjectDetailScreen = () => {
  const navigation = useNavigation<RootStackNavigationProp>();
  const route = useRoute<ProjectDetailRouteProp>();
  const {projectId} = route.params;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backButton}>← 返回</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>项目详情</Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.content}>
        <Text style={styles.placeholder}>项目ID: {projectId}</Text>
        <Text style={styles.hint}>详情页开发中...</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.base,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    backgroundColor: colors.background.layer1,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
  },
  backButton: {
    fontSize: theme.fontSizes.md,
    color: colors.primary[500],
  },
  headerTitle: {
    fontSize: theme.fontSizes.lg,
    fontWeight: theme.fontWeights.semibold,
    color: colors.text.primary,
  },
  headerSpacer: {
    width: 50,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholder: {
    fontSize: theme.fontSizes.lg,
    color: colors.text.primary,
    marginBottom: theme.spacing.sm,
  },
  hint: {
    fontSize: theme.fontSizes.sm,
    color: colors.text.tertiary,
  },
});
