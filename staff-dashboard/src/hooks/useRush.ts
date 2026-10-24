import { useCallback, useState } from 'react';
import { RUSH_KEY } from '../config';

/** Local "rush" priority flags for jobs. The sheet is read-only ordering, so
 *  priority is an operator-side override stored on the shop PC. */
export function useRush() {
  const [ids, setIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(RUSH_KEY);
      return new Set<string>(raw ? JSON.parse(raw) : []);
    } catch {
      return new Set<string>();
    }
  });

  const persist = (next: Set<string>) => {
    setIds(next);
    try {
      localStorage.setItem(RUSH_KEY, JSON.stringify(Array.from(next)));
    } catch {
      /* non-fatal */
    }
  };

  const isRushed = useCallback((id: string) => ids.has(id), [ids]);

  const toggleRush = useCallback((id: string) => {
    const next = new Set(ids);
    if (next.has(id)) next.delete(id); else next.add(id);
    persist(next);
  }, [ids]);

  return { isRushed, toggleRush };
}
