import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { color as c } from '../theme/tokens';

/** Shows a spinner only after `delay` ms (G01 §3: local reads rarely need one). */
export function DelayedSpinner({ delay = 300 }: { delay?: number }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), delay);
    return () => clearTimeout(t);
  }, [delay]);
  return <View style={styles.center}>{show ? <ActivityIndicator color={c.ink3} /> : null}</View>;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
});
