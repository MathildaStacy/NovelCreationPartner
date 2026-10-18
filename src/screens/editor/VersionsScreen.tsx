import React from 'react';
import { View } from 'react-native';
import { NavBar } from '../../components/NavBar';
import type { RootScreenProps } from '../../app/navigation/types';

/** Placeholder — replaced by the real screen. */
export function VersionsScreen({ navigation }: RootScreenProps<'Versions'>) {
  return (
    <View>
      <NavBar title="Versions" onBack={() => navigation.goBack()} />
    </View>
  );
}
