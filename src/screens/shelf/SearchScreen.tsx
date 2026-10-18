import React from 'react';
import { View } from 'react-native';
import { NavBar } from '../../components/NavBar';
import type { RootScreenProps } from '../../app/navigation/types';

/** Placeholder — replaced by the real screen. */
export function SearchScreen({ navigation }: RootScreenProps<'Search'>) {
  return (
    <View>
      <NavBar title="Search" onBack={() => navigation.goBack()} />
    </View>
  );
}
