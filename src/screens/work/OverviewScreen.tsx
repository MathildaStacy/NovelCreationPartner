import React from 'react';
import { View } from 'react-native';
import { NavBar } from '../../components/NavBar';
import type { WorkTabScreenProps } from '../../app/navigation/types';

/** Placeholder — replaced by the real screen. */
export function OverviewScreen({ navigation }: WorkTabScreenProps<'Overview'>) {
  return (
    <View>
      <NavBar title="Overview" onBack={() => navigation.goBack()} />
    </View>
  );
}
