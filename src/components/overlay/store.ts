/**
 * Toasts and dialogs (G01 §4). Screens call `toast()` / `showDialog()`; hosts
 * render them. Each open Sheet (an RN Modal) renders its own host, and only the
 * topmost host shows overlays, so a toast or dialog is never hidden under a sheet.
 */
import { create } from 'zustand';

export interface ToastSpec {
  id: number;
  message: string;
  action?: { label: string; onPress: () => void };
  /** ms; 2.5 s plain, 5 s with an action (G01). */
  duration: number;
}

export type DialogButtonStyle = 'default' | 'primary' | 'cancel';

export interface DialogButton {
  key: string;
  label: string;
  style?: DialogButtonStyle;
  /** Work done while the button shows a spinner; the dialog closes when it settles. */
  run?: () => Promise<unknown>;
}

export interface DialogSpec {
  title: string;
  message?: string;
  /** Extra paragraphs below the message. */
  notes?: string[];
  buttons: DialogButton[];
  /** Stack buttons vertically (3+ choices). */
  vertical?: boolean;
  /** Key resolved when dismissed by back button / scrim; null = not dismissable. */
  dismissKey?: string | null;
}

interface PendingDialog extends DialogSpec {
  id: number;
  resolve: (key: string) => void;
  reject: (e: unknown) => void;
}

interface OverlayState {
  toast: ToastSpec | null;
  dialogs: PendingDialog[];
  /** Number of open sheets; the host at this level is the visible one. */
  depth: number;
}

export const useOverlay = create<OverlayState>(() => ({ toast: null, dialogs: [], depth: 0 }));

let seq = 0;

export function toast(message: string, opts: { action?: ToastSpec['action']; duration?: number } = {}): void {
  const duration = opts.duration ?? (opts.action ? 5000 : 2500);
  useOverlay.setState({ toast: { id: ++seq, message, action: opts.action, duration } });
}

export function hideToast(id?: number): void {
  const cur = useOverlay.getState().toast;
  if (cur && (id === undefined || cur.id === id)) {
    useOverlay.setState({ toast: null });
  }
}

/** Resolves with the key of the pressed button. Rejects if a button's `run` throws. */
export function showDialog(spec: DialogSpec): Promise<string> {
  return new Promise((resolve, reject) => {
    const d: PendingDialog = { ...spec, id: ++seq, resolve, reject };
    useOverlay.setState(s => ({ dialogs: [...s.dialogs, d] }));
  });
}

export function closeDialog(id: number): void {
  useOverlay.setState(s => ({ dialogs: s.dialogs.filter(d => d.id !== id) }));
}

export function pushSheet(): number {
  const depth = useOverlay.getState().depth + 1;
  useOverlay.setState({ depth });
  return depth;
}

export function popSheet(): void {
  useOverlay.setState(s => ({ depth: Math.max(0, s.depth - 1) }));
}

export type { PendingDialog };
