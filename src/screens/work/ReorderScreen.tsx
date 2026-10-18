import React from 'react';
import { View } from 'react-native';
import { NavBar } from '../../components/NavBar';
import type { RootScreenProps } from '../../app/navigation/types';

/** Placeholder — replaced by the real screen. */
export function ReorderScreen({ navigation }: RootScreenProps<'Reorder'>) {
  return (
    <View>
      <NavBar title="Reorder" onBack={() => navigation.goBack()} />
    </View>
  );
}
