import React from 'react';
import { View } from 'react-native';
import { NavBar } from '../../components/NavBar';
import type { RootScreenProps } from '../../app/navigation/types';

/** Placeholder — replaced by the real screen. */
export function WorkInfoScreen({ navigation }: RootScreenProps<'WorkInfo'>) {
  return (
    <View>
      <NavBar title="WorkInfo" onBack={() => navigation.goBack()} />
    </View>
  );
}
