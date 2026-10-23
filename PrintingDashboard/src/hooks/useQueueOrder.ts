import { useCallback, useState } from 'react';
import { QUEUE_ORDER_KEY } from '../config';

/** Manual queue ordering (drag-to-reorder). Stores an ordered list of job ids;
 *  jobs not in the list fall back to their natural (time) order. Local to the
 *  shop PC since the sheet order is read-only. */
export function useQueueOrder() {
  const [order, setOrder] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(QUEUE_ORDER_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  const persist = (next: string[]) => {
    setOrder(next);
    try {
      localStorage.setItem(QUEUE_ORDER_KEY, JSON.stringify(next));
    } catch {
      /* non-fatal */
    }
  };

  /** Index of a job in the manual order, or a large number if unset. */
  const orderIndex = useCallback(
    (id: string) => {
      const i = order.indexOf(id);
      return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    },
    [order],
  );

  /** Move `draggedId` to just before `targetId`. */
  const move = useCallback((draggedId: string, targetId: string, allIds: string[]) => {
    if (draggedId === targetId) return;
    // Seed from current visible order so untracked ids get positions.
    const base = allIds.slice();
    const from = base.indexOf(draggedId);
    const to = base.indexOf(targetId);
    if (from === -1 || to === -1) return;
    base.splice(from, 1);
    base.splice(base.indexOf(targetId), 0, draggedId);
    persist(base);
  }, []);

  return { orderIndex, move };
}
