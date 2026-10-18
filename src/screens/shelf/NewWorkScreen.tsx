import React from 'react';
import { View } from 'react-native';
import { NavBar } from '../../components/NavBar';
import type { RootScreenProps } from '../../app/navigation/types';

/** Placeholder — replaced by the real screen. */
export function NewWorkScreen({ navigation }: RootScreenProps<'NewWork'>) {
  return (
    <View>
      <NavBar title="NewWork" onBack={() => navigation.goBack()} />
    </View>
  );
}
