import React from 'react';
import { View } from 'react-native';
import { NavBar } from '../../components/NavBar';
import type { RootScreenProps } from '../../app/navigation/types';

/** Placeholder — replaced by the real screen. */
export function ShelfScreen({ navigation }: RootScreenProps<'Shelf'>) {
  return (
    <View>
      <NavBar title="我的书架" large onBack={navigation.canGoBack() ? navigation.goBack : undefined} />
    </View>
  );
}
