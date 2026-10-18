import { createContext, useContext } from 'react';
import type { ID } from '../../features/types';

/** The work the tabs belong to (S05–S11 read it instead of route params). */
export const WorkContext = createContext<ID | null>(null);

export function useWorkId(): ID {
  const id = useContext(WorkContext);
  if (!id) {
    throw new Error('useWorkId outside a work');
  }
  return id;
}
