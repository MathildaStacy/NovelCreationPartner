import React from 'react';
import { View } from 'react-native';
import { NavBar } from '../../components/NavBar';
import type { WorkTabScreenProps } from '../../app/navigation/types';

/** Placeholder — replaced by the real screen. */
export function ChaptersScreen({ navigation }: WorkTabScreenProps<'Chapters'>) {
  return (
    <View>
      <NavBar title="Chapters" onBack={() => navigation.goBack()} />
    </View>
  );
}
