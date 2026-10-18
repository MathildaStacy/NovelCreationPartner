/** One foreground worker; cancelled or uncertain sent attempts require author action before replay. */
import { AppState } from 'react-native';
import { on } from '../features/events';
import * as jobs from '../features/jobs';
import { drain } from '../features/finalizationRunner';

export function startJobQueue(): () => void {
  let disposed = false;
  let scheduled = false;
  let running = false;
  let wakeAfterRun = false;
  let controller = new AbortController();
  const tick = () => {
    if (disposed || AppState.currentState !== 'active') return;
    if (running) { wakeAfterRun = true; return; }
    if (scheduled) return;
    scheduled = true;
    setTimeout(async () => {
      scheduled = false;
      if (disposed || running || AppState.currentState !== 'active') return;
      running = true;
      controller = new AbortController();
      try { await jobs.pauseWithoutService(); await drain(controller.signal); }
      catch { /* Individual task errors are persisted by the runner; never log content. */ }
      finally {
        running = false;
        if (wakeAfterRun) { wakeAfterRun = false; tick(); }
      }
    }, 0);
  };
  const offs = [on('jobs.changed', tick), on('services.changed', tick)];
  const app = AppState.addEventListener('change', state => {
    if (state === 'active') tick();
    else controller.abort();
  });
  tick();
  return () => { disposed = true; controller.abort(); offs.forEach(off => off()); app.remove(); };
}
