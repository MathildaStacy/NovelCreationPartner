import React from 'react';
import { View } from 'react-native';
import { NavBar } from '../../components/NavBar';
import type { RootScreenProps } from '../../app/navigation/types';

/** Placeholder — replaced by the real screen. */
export function EditorScreen({ navigation }: RootScreenProps<'Editor'>) {
  return (
    <View>
      <NavBar title="Editor" onBack={() => navigation.goBack()} />
    </View>
  );
}
