import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../components/Button';
import { Txt } from '../../components/Text';
import { TextField } from '../../components/TextField';
import { runNativeProbe } from '../../features/modelTransportProbe';
import { modelServiceText } from '../../locales/modelServices';
import { color } from '../../theme/tokens';

const t = modelServiceText.probe;
export default function ModelProbeApp() {
  const [origin, setOrigin] = useState('http://127.0.0.1:8765');
  const [result, setResult] = useState('');
  const [running, setRunning] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => { request.current?.abort(); request.current = null; }, []);
  const run = async () => {
    const controller = new AbortController();
    request.current = controller;
    setRunning(true);
    setResult('');
    try {
      const evidence = await runNativeProbe(origin.trim(), controller.signal);
      if (request.current === controller && !controller.signal.aborted) { setResult(JSON.stringify(evidence, null, 2)); }
    } catch {
      if (request.current === controller && !controller.signal.aborted) { setResult(t.failed); }
    } finally {
      if (request.current === controller) { setRunning(false); request.current = null; }
    }
  };
  return <SafeAreaProvider><SafeAreaView style={styles.root}><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <Txt variant="title1">{t.title}</Txt><Txt>{t.help}</Txt>
    <TextField label={t.address} value={origin} onChangeText={setOrigin} autoCapitalize="none" autoCorrect={false} editable={!running} />
    <Button label={t.start} loading={running} onPress={run} />
    {running ? <Button variant="text" label={t.stop} onPress={() => request.current?.abort()} /> : null}
    <Txt selectable>{result}</Txt>
  </ScrollView></SafeAreaView></SafeAreaProvider>;
}
const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: color.paper }, content: { padding: 20, gap: 20 } });
