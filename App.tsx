/**
 * App root: safe area, startup (G02 §10), navigation, and the root overlay host
 * for toasts and dialogs (G01 §4).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { AppState, StatusBar, StyleSheet, View } from 'react-native';
import { DefaultTheme, NavigationContainer, createNavigationContainerRef, type Theme } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { boot, type BootResult } from './src/app/boot';
import { startJobQueue } from './src/app/jobQueue';
import { startPassageIndexer } from './src/app/passageIndexQueue';
import { watchJobFailures } from './src/app/jobFailureToast';
import type { RootStackParamList } from './src/app/navigation/types';
import { RootStack } from './src/app/navigation/RootStack';
import { OverlayHost } from './src/components/overlay/OverlayHost';
import type { Db } from './src/data/db';
import { openDeviceDb } from './src/data/drivers/opSqlite';
import { BootErrorScreen } from './src/screens/boot/BootErrorScreen';
import { color as c } from './src/theme/tokens';
import { retryPendingCleanup } from './src/features/modelServices';

const theme: Theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: c.brand,
    background: c.paper,
    card: c.surface,
    text: c.ink,
    border: c.line,
    notification: c.conf,
  },
};

const navigationRef = createNavigationContainerRef<RootStackParamList>();

export interface AppProps {
  /** Injected by tests; the device uses op-sqlite. */
  openDatabase?: () => Db;
}

function App({ openDatabase = openDeviceDb }: AppProps) {
  const [state, setState] = useState<BootResult | null>(null);

  const start = useCallback(() => {
    setState(null);
    boot(openDatabase).then(setState);
  }, [openDatabase]);

  useEffect(start, [start]);

  useEffect(() => (state?.ok ? startJobQueue() : undefined), [state]);
  useEffect(() => (state?.ok ? startPassageIndexer() : undefined), [state]);
  useEffect(() => (state?.ok ? watchJobFailures(navigationRef) : undefined), [state]);

  useEffect(() => {
    if (!state?.ok) { return; }
    const listener = AppState.addEventListener('change', next => {
      if (next === 'active') {
        // Cleanup failures leave durable references; offline writing stays usable.
        retryPendingCleanup().catch(() => {});
      }
    });
    return () => listener.remove();
  }, [state]);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" />
      <View style={styles.root}>
        {state == null ? null : state.ok ? (
          <NavigationContainer ref={navigationRef} theme={theme}>
            <RootStack initialRoute={state.route} />
          </NavigationContainer>
        ) : (
          <BootErrorScreen stage={state.stage} error={state.error} onRetry={start} />
        )}
        <OverlayHost level={0} />
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: c.paper } });

export default App;
