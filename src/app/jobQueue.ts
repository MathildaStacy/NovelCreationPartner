/**
 * Job queue driver (G02 §6). The AI runner is not built yet (G03); for now the
 * queue only applies its first check — no model service → paused (no_service) —
 * whenever jobs or services change, so finalize shows a truthful state.
 */
import { on } from '../features/events';
import * as jobs from '../features/jobs';

export function startJobQueue(): () => void {
  let scheduled = false;
  const tick = () => {
    if (scheduled) {
      return;
    }
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      jobs.pauseWithoutService().catch(e => console.warn('[jobs] check failed', e));
    }, 0);
  };
  const offs = [on('jobs.changed', tick), on('services.changed', tick)];
  tick();
  return () => offs.forEach(off => off());
}
