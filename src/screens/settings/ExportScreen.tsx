import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { RootScreenProps } from '../../app/navigation/types';
import { ExportSheet } from './ExportSheet';

/** Preview entry for work/chapter action sheets; exporting still requires an explicit author press. */
export function ExportScreen({navigation,route}:RootScreenProps<'Export'>){
  return <View style={styles.root}><ExportSheet visible onClose={()=>navigation.goBack()} initialWorkId={route.params.workId}
    initialChapterIds={route.params.chapterId?[route.params.chapterId]:undefined}/></View>;
}
const styles=StyleSheet.create({root:{flex:1}});
