/**
 * 底部Tab导航
 */

import React from 'react';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import {MainTabParamList} from './types';
import {HomeScreen} from '../screens/home/HomeScreen';
import {ProjectListScreen} from '../screens/project/ProjectListScreen';
import {SettingsScreen} from '../screens/settings/SettingsScreen';
import {colors, theme} from '../constants';
import {Text, View, StyleSheet} from 'react-native';

const Tab = createBottomTabNavigator<MainTabParamList>();

// 简单的图标组件（后续可以替换为真实图标）
const TabIcon = React.memo(
  ({label, focused}: {label: string; focused: boolean}) => (
    <View style={styles.iconContainer}>
      <View style={[styles.iconDot, focused && styles.iconDotActive]} />
      <Text style={[styles.iconLabel, focused && styles.iconLabelActive]}>
        {label}
      </Text>
    </View>
  ),
);

// 预定义的图标组件
const HomeIcon = ({focused}: {focused: boolean}) => (
  <TabIcon label="🏠" focused={focused} />
);
const ProjectsIcon = ({focused}: {focused: boolean}) => (
  <TabIcon label="📚" focused={focused} />
);
const CreateIcon = ({focused}: {focused: boolean}) => (
  <TabIcon label="✨" focused={focused} />
);
const SettingsIcon = ({focused}: {focused: boolean}) => (
  <TabIcon label="⚙️" focused={focused} />
);

export const MainTabNavigator = () => {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.background.layer1,
          borderTopColor: colors.border.default,
          borderTopWidth: 1,
          height: 60,
          paddingBottom: 8,
          paddingTop: 8,
        },
        tabBarActiveTintColor: colors.primary[500],
        tabBarInactiveTintColor: colors.text.tertiary,
        tabBarLabelStyle: {
          fontSize: theme.fontSizes.xs,
          fontWeight: theme.fontWeights.medium,
        },
      }}>
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{
          tabBarLabel: '首页',
          tabBarIcon: HomeIcon,
        }}
      />
      <Tab.Screen
        name="Projects"
        component={ProjectListScreen}
        options={{
          tabBarLabel: '项目',
          tabBarIcon: ProjectsIcon,
        }}
      />
      <Tab.Screen
        name="Create"
        component={HomeScreen}
        options={{
          tabBarLabel: '创作',
          tabBarIcon: CreateIcon,
        }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          tabBarLabel: '设置',
          tabBarIcon: SettingsIcon,
        }}
      />
    </Tab.Navigator>
  );
};

const styles = StyleSheet.create({
  iconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.text.tertiary,
    marginBottom: 4,
  },
  iconDotActive: {
    backgroundColor: colors.primary[500],
  },
  iconLabel: {
    fontSize: 20,
  },
  iconLabelActive: {
    transform: [{scale: 1.1}],
  },
});
