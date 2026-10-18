import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { EditorScreen } from '../../screens/editor/EditorScreen';
import { VersionDiffScreen } from '../../screens/editor/VersionDiffScreen';
import { VersionsScreen } from '../../screens/editor/VersionsScreen';
import { NewWorkScreen } from '../../screens/shelf/NewWorkScreen';
import { SearchScreen } from '../../screens/shelf/SearchScreen';
import { ShelfScreen } from '../../screens/shelf/ShelfScreen';
import { ReorderScreen } from '../../screens/work/ReorderScreen';
import { WorkInfoScreen } from '../../screens/work/WorkInfoScreen';
import { color as c } from '../../theme/tokens';
import type { RootStackParamList } from './types';
import { WorkTabs } from './WorkTabs';

const Stack = createNativeStackNavigator<RootStackParamList>();

/** Root stack (G01 §1). Screens draw their own NavBar; the stack keeps native back gestures and the Android back key. */
export function RootStack() {
  return (
    <Stack.Navigator
      initialRouteName="Shelf"
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.paper } }}
    >
      <Stack.Screen name="Shelf" component={ShelfScreen} />
      <Stack.Screen name="Search" component={SearchScreen} options={{ animation: 'fade' }} />
      <Stack.Screen name="NewWork" component={NewWorkScreen} options={{ animation: 'slide_from_bottom' }} />
      <Stack.Screen name="Work" component={WorkTabs} />
      <Stack.Screen name="WorkInfo" component={WorkInfoScreen} />
      <Stack.Screen name="Editor" component={EditorScreen} />
      <Stack.Screen name="Versions" component={VersionsScreen} />
      <Stack.Screen name="VersionDiff" component={VersionDiffScreen} />
      <Stack.Screen name="Reorder" component={ReorderScreen} />
    </Stack.Navigator>
  );
}
