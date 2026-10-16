/**
 * 首页
 */

import React from 'react';
import {View, Text, StyleSheet, StatusBar} from 'react-native';
import {colors} from '../../constants';

export const HomeScreen = () => {
  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <Text style={styles.title}>AI小说创作伙伴</Text>
      <Text style={styles.subtitle}>开启你的创作之旅</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.base,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: colors.text.primary,
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 16,
    color: colors.text.secondary,
  },
});
