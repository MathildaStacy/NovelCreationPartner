/** Optional author-selected task bindings. A missing binding uses the current default; a broken binding never switches hosts. */
import * as services from './modelServices';
import * as prefs from './prefs';
import { AppError, isAppError } from './errors';
export type TaskRoute = 'writing' | 'utility' | 'review';
export async function getTaskService(route: TaskRoute): Promise<services.ServiceDetail | null> {
  const bindings = await prefs.get('serviceBindings');
  const id = bindings?.[route];
  if (!id) {
    const selected = await services.getDefault();
    return selected ? services.get(selected.id) : null;
  }
  try { return await services.get(id); }
  catch (error) {
    if (isAppError(error, 'NOT_FOUND')) { throw new AppError('NO_SERVICE', '这项任务绑定的模型服务已不存在，请在设置中重新选择。'); }
    throw error;
  }
}
export async function setTaskService(route: TaskRoute, serviceId: string | null): Promise<void> {
  if (!['writing', 'utility', 'review'].includes(route)) { throw new AppError('VALIDATION', '未知任务类型。'); }
  if (serviceId) { await services.get(serviceId); }
  await prefs.set('serviceBindings', { ...prefs.DEFAULTS.serviceBindings, ...await prefs.get('serviceBindings'), [route]: serviceId });
}
