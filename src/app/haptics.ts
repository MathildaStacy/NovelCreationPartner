import { Platform, Vibration } from 'react-native';

/**
 * Light haptic for long presses (S03a #1). Android: a short vibration (needs the
 * VIBRATE permission). iOS core RN only offers a 400 ms buzz, so nothing there
 * until a haptics module is added.
 */
export function lightHaptic(): void {
  if (Platform.OS === 'android') {
    Vibration.vibrate(12);
  }
}
