import React from 'react';
import { View } from 'react-native';
import { NavBar } from '../../components/NavBar';
import type { RootScreenProps } from '../../app/navigation/types';

/** Placeholder — replaced by the real screen. */
export function VersionDiffScreen({ navigation }: RootScreenProps<'VersionDiff'>) {
  return (
    <View>
      <NavBar title="VersionDiff" onBack={() => navigation.goBack()} />
    </View>
  );
}
