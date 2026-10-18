import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { EntryDetailScreen } from '../../screens/archive/EntryDetailScreen';
import { EntryFormScreen } from '../../screens/archive/EntryFormScreen';
import { EntryHistoryScreen } from '../../screens/archive/EntryHistoryScreen';
import { EditorScreen } from '../../screens/editor/EditorScreen';
import { VersionDiffScreen } from '../../screens/editor/VersionDiffScreen';
import { VersionsScreen } from '../../screens/editor/VersionsScreen';
import { NewWorkScreen } from '../../screens/shelf/NewWorkScreen';
import { SearchScreen } from '../../screens/shelf/SearchScreen';
import { ShelfScreen } from '../../screens/shelf/ShelfScreen';
import { ModelServiceScreen } from '../../screens/settings/model/ModelServiceScreen';
import { JobsScreen } from '../../screens/work/JobsScreen';
import { ReviewScreen } from '../../screens/review/ReviewScreen';
import { ConflictsScreen } from '../../screens/review/ConflictsScreen';
import { ConflictDetailScreen } from '../../screens/review/ConflictDetailScreen';
import { SettingsScreen } from '../../screens/settings/SettingsScreen';
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
      screenOptions={{ headerShown: false, statusBarStyle: 'dark', contentStyle: { backgroundColor: c.paper } }}
    >
      <Stack.Screen name="Shelf" component={ShelfScreen} />
      <Stack.Screen name="Search" component={SearchScreen} options={{ animation: 'fade' }} />
      <Stack.Screen name="NewWork" component={NewWorkScreen} options={{ animation: 'slide_from_bottom' }} />
      <Stack.Screen name="Work" component={WorkTabs} />
      <Stack.Screen name="WorkInfo" component={WorkInfoScreen} />
      <Stack.Screen name="Jobs" component={JobsScreen} />
      <Stack.Screen name="Review" component={ReviewScreen} />
      <Stack.Screen name="Conflicts" component={ConflictsScreen} />
      <Stack.Screen name="ConflictDetail" component={ConflictDetailScreen} />
      <Stack.Screen name="EntryDetail" component={EntryDetailScreen} />
      <Stack.Screen name="EntryForm" component={EntryFormScreen} />
      <Stack.Screen name="EntryHistory" component={EntryHistoryScreen} />
      <Stack.Screen name="Editor" component={EditorScreen} />
      <Stack.Screen name="Versions" component={VersionsScreen} />
      <Stack.Screen name="VersionDiff" component={VersionDiffScreen} />
      <Stack.Screen name="Reorder" component={ReorderScreen} />
      <Stack.Screen name="Settings" component={SettingsScreen} />
      <Stack.Screen name="ModelService" component={ModelServiceScreen} />
    </Stack.Navigator>
  );
}
