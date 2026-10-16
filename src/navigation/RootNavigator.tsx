/**
 * 根导航器
 */

import React from 'react';
import {NavigationContainer} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {RootStackParamList} from './types';
import {MainTabNavigator} from './MainTabNavigator';
import {ProjectDetailScreen} from '../screens/project/ProjectDetailScreen';
import {CreateProjectScreen} from '../screens/project/CreateProjectScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

export const RootNavigator = () => {
  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
        }}>
        <Stack.Screen name="MainTab" component={MainTabNavigator} />
        <Stack.Screen
          name="ProjectDetail"
          component={ProjectDetailScreen}
        />
        <Stack.Screen
          name="CreateProject"
          component={CreateProjectScreen}
          options={{
            presentation: 'modal',
            animation: 'slide_from_bottom',
          }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
};
