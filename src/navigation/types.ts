/**
 * 导航类型定义
 */

import {RouteProp} from '@react-navigation/native';
import {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {BottomTabNavigationProp} from '@react-navigation/bottom-tabs';

// 主Stack导航参数
export type RootStackParamList = {
  MainTab: undefined;
  ProjectDetail: {projectId: string};
  CreateProject: undefined;
  ChapterEditor: {chapterId?: string; projectId: string};
  CharacterDetail: {characterId: string};
  CreateCharacter: {projectId: string};
};

// 底部Tab导航参数
export type MainTabParamList = {
  Home: undefined;
  Projects: undefined;
  Create: undefined;
  Settings: undefined;
};

// 导航属性类型
export type RootStackNavigationProp =
  NativeStackNavigationProp<RootStackParamList>;
export type MainTabNavigationProp = BottomTabNavigationProp<MainTabParamList>;

// 路由属性类型
export type ProjectDetailRouteProp = RouteProp<
  RootStackParamList,
  'ProjectDetail'
>;
export type ChapterEditorRouteProp = RouteProp<
  RootStackParamList,
  'ChapterEditor'
>;
export type CharacterDetailRouteProp = RouteProp<
  RootStackParamList,
  'CharacterDetail'
>;
export type CreateCharacterRouteProp = RouteProp<
  RootStackParamList,
  'CreateCharacter'
>;

// 组合类型（导航+路由）
export type ProjectDetailScreenProps = {
  navigation: RootStackNavigationProp;
  route: ProjectDetailRouteProp;
};

export type ChapterEditorScreenProps = {
  navigation: RootStackNavigationProp;
  route: ChapterEditorRouteProp;
};

export type CharacterDetailScreenProps = {
  navigation: RootStackNavigationProp;
  route: CharacterDetailRouteProp;
};

export type CreateCharacterScreenProps = {
  navigation: RootStackNavigationProp;
  route: CreateCharacterRouteProp;
};
