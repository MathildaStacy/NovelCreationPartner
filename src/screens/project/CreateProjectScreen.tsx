/**
 * 创建项目页面
 */

import React, {useState} from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  Alert,
} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import {RootStackNavigationProp} from '../../navigation/types';
import {useProjectStore} from '../../store/projectStore';
import {colors, theme} from '../../constants';

const GENRES = [
  '玄幻',
  '仙侠',
  '科幻',
  '都市',
  '悬疑',
  '言情',
  '历史',
  '军事',
  '游戏',
  '其他',
];

export const CreateProjectScreen = () => {
  const navigation = useNavigation<RootStackNavigationProp>();
  const {createProject} = useProjectStore();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedGenre, setSelectedGenre] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim()) {
      Alert.alert('提示', '请输入项目名称');
      return;
    }

    setIsSubmitting(true);
    try {
      await createProject({
        name: name.trim(),
        description: description.trim() || undefined,
        genre: selectedGenre || undefined,
      });

      Alert.alert('成功', '项目创建成功', [
        {
          text: '确定',
          onPress: () => navigation.goBack(),
        },
      ]);
    } catch {
      Alert.alert('错误', '创建项目失败，请重试');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.headerButton}>取消</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>新建项目</Text>
        <TouchableOpacity
          onPress={handleSubmit}
          disabled={isSubmitting || !name.trim()}>
          <Text
            style={[
              styles.headerButton,
              styles.headerButtonPrimary,
              (!name.trim() || isSubmitting) && styles.headerButtonDisabled,
            ]}>
            {isSubmitting ? '创建中...' : '完成'}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled">
        <View style={styles.section}>
          <Text style={styles.label}>
            项目名称 <Text style={styles.required}>*</Text>
          </Text>
          <TextInput
            style={styles.input}
            placeholder="给你的小说起个名字"
            placeholderTextColor={colors.text.tertiary}
            value={name}
            onChangeText={setName}
            maxLength={50}
            autoFocus
          />
          <Text style={styles.hint}>{name.length}/50</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>简介</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="简单描述一下你的故事..."
            placeholderTextColor={colors.text.tertiary}
            value={description}
            onChangeText={setDescription}
            maxLength={200}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />
          <Text style={styles.hint}>{description.length}/200</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>题材分类</Text>
          <View style={styles.genreGrid}>
            {GENRES.map(genre => (
              <TouchableOpacity
                key={genre}
                style={[
                  styles.genreChip,
                  selectedGenre === genre && styles.genreChipSelected,
                ]}
                onPress={() =>
                  setSelectedGenre(selectedGenre === genre ? '' : genre)
                }
                activeOpacity={0.7}>
                <Text
                  style={[
                    styles.genreChipText,
                    selectedGenre === genre && styles.genreChipTextSelected,
                  ]}>
                  {genre}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.tipBox}>
          <Text style={styles.tipTitle}>💡 提示</Text>
          <Text style={styles.tipText}>
            创建项目后，你可以开始添加章节、设定人物和世界观。AI助手会帮助你完善创意。
          </Text>
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
    fontSize: theme.fontSizes.lg,
    fontWeight: theme.fontWeights.semibold,
    color: colors.text.primary,
  },
  headerButton: {
    fontSize: theme.fontSizes.md,
    color: colors.text.secondary,
    paddingHorizontal: theme.spacing.sm,
  },
  headerButtonPrimary: {
    color: colors.primary[500],
    fontWeight: theme.fontWeights.semibold,
  },
  headerButtonDisabled: {
    color: colors.text.disabled,
  },
  content: {
    flex: 1,
    padding: theme.spacing.md,
  },
  section: {
    marginBottom: theme.spacing.lg,
  },
  label: {
    fontSize: theme.fontSizes.md,
    fontWeight: theme.fontWeights.medium,
    color: colors.text.primary,
    marginBottom: theme.spacing.sm,
  },
  required: {
    color: colors.status.error,
  },
  input: {
    backgroundColor: colors.background.layer2,
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: theme.radii.lg,
    padding: theme.spacing.md,
    fontSize: theme.fontSizes.md,
    color: colors.text.primary,
  },
  textArea: {
    minHeight: 100,
    paddingTop: theme.spacing.md,
  },
  hint: {
    fontSize: theme.fontSizes.xs,
    color: colors.text.tertiary,
    marginTop: theme.spacing.xs,
    textAlign: 'right',
  },
  genreGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  genreChip: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    backgroundColor: colors.background.layer2,
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: theme.radii.full,
  },
  genreChipSelected: {
    backgroundColor: colors.primary[500],
    borderColor: colors.primary[500],
  },
  genreChipText: {
    fontSize: theme.fontSizes.sm,
    color: colors.text.secondary,
  },
  genreChipTextSelected: {
    color: colors.text.primary,
    fontWeight: theme.fontWeights.medium,
  },
  tipBox: {
    backgroundColor: colors.background.layer2,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary[500],
    borderRadius: theme.radii.lg,
    padding: theme.spacing.md,
    marginTop: theme.spacing.md,
  },
  tipTitle: {
    fontSize: theme.fontSizes.md,
    fontWeight: theme.fontWeights.semibold,
    color: colors.text.primary,
    marginBottom: theme.spacing.xs,
  },
  tipText: {
    fontSize: theme.fontSizes.sm,
    color: colors.text.secondary,
    lineHeight: theme.fontSizes.sm * theme.lineHeights.relaxed,
  },
});
