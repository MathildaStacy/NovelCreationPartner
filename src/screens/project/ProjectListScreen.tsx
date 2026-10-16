/**
 * 项目列表页
 */

import React, {useEffect} from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  StatusBar,
  ActivityIndicator,
} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import {RootStackNavigationProp} from '../../navigation/types';
import {useProjectStore} from '../../store/projectStore';
import {colors, theme} from '../../constants';
import {Project} from '../../types';

export const ProjectListScreen = () => {
  const navigation = useNavigation<RootStackNavigationProp>();
  const {projects, isLoading, fetchProjects} = useProjectStore();

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const handleProjectPress = (projectId: string) => {
    navigation.navigate('ProjectDetail', {projectId});
  };

  const handleCreateProject = () => {
    navigation.navigate('CreateProject');
  };

  const renderProjectCard = ({item}: {item: Project}) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => handleProjectPress(item.id)}
      activeOpacity={0.7}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>{item.name}</Text>
        <View
          style={[
            styles.statusBadge,
            {backgroundColor: getStatusColor(item.status)},
          ]}>
          <Text style={styles.statusText}>{getStatusText(item.status)}</Text>
        </View>
      </View>

      {item.description && (
        <Text style={styles.cardDescription} numberOfLines={2}>
          {item.description}
        </Text>
      )}

      <View style={styles.cardFooter}>
        <View style={styles.statItem}>
          <Text style={styles.statLabel}>章节</Text>
          <Text style={styles.statValue}>{item.chapterCount}</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statLabel}>字数</Text>
          <Text style={styles.statValue}>
            {(item.wordCount / 1000).toFixed(1)}k
          </Text>
        </View>
        {item.genre && (
          <View style={styles.genreBadge}>
            <Text style={styles.genreText}>{item.genre}</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyText}>还没有项目</Text>
      <Text style={styles.emptyHint}>点击右上角创建第一个小说项目</Text>
    </View>
  );

  if (isLoading && projects.length === 0) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary[500]} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      <View style={styles.header}>
        <Text style={styles.headerTitle}>我的项目</Text>
        <TouchableOpacity
          style={styles.createButton}
          onPress={handleCreateProject}>
          <Text style={styles.createButtonText}>+ 新建</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={projects}
        renderItem={renderProjectCard}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={renderEmpty}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
};

const getStatusColor = (status: string): string => {
  switch (status) {
    case 'draft':
      return colors.functional.draft;
    case 'in_progress':
      return colors.functional.writing;
    case 'completed':
      return colors.functional.completed;
    case 'archived':
      return colors.functional.archived;
    default:
      return colors.functional.draft;
  }
};

const getStatusText = (status: string): string => {
  switch (status) {
    case 'draft':
      return '草稿';
    case 'in_progress':
      return '创作中';
    case 'completed':
      return '已完成';
    case 'archived':
      return '已归档';
    default:
      return '未知';
  }
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.base,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: colors.background.base,
    justifyContent: 'center',
    alignItems: 'center',
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
  headerTitle: {
    fontSize: theme.fontSizes['2xl'],
    fontWeight: theme.fontWeights.bold,
    color: colors.text.primary,
  },
  createButton: {
    backgroundColor: colors.primary[500],
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radii.lg,
  },
  createButtonText: {
    color: colors.text.primary,
    fontSize: theme.fontSizes.md,
    fontWeight: theme.fontWeights.semibold,
  },
  listContent: {
    padding: theme.spacing.md,
  },
  card: {
    backgroundColor: colors.background.layer2,
    borderRadius: theme.radii.xl,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.md,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: theme.spacing.sm,
  },
  cardTitle: {
    flex: 1,
    fontSize: theme.fontSizes.xl,
    fontWeight: theme.fontWeights.bold,
    color: colors.text.primary,
    marginRight: theme.spacing.sm,
  },
  statusBadge: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 4,
    borderRadius: theme.radii.full,
  },
  statusText: {
    fontSize: theme.fontSizes.xs,
    color: colors.text.primary,
    fontWeight: theme.fontWeights.medium,
  },
  cardDescription: {
    fontSize: theme.fontSizes.sm,
    color: colors.text.secondary,
    lineHeight: theme.fontSizes.sm * theme.lineHeights.normal,
    marginBottom: theme.spacing.md,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  statLabel: {
    fontSize: theme.fontSizes.xs,
    color: colors.text.tertiary,
  },
  statValue: {
    fontSize: theme.fontSizes.md,
    fontWeight: theme.fontWeights.semibold,
    color: colors.text.primary,
  },
  genreBadge: {
    marginLeft: 'auto',
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 4,
    backgroundColor: colors.alpha.primary10,
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: colors.alpha.primary20,
  },
  genreText: {
    fontSize: theme.fontSizes.xs,
    color: colors.primary[500],
    fontWeight: theme.fontWeights.medium,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: theme.spacing['3xl'],
  },
  emptyText: {
    fontSize: theme.fontSizes.lg,
    color: colors.text.secondary,
    marginBottom: theme.spacing.sm,
  },
  emptyHint: {
    fontSize: theme.fontSizes.sm,
    color: colors.text.tertiary,
  },
});
