import { useEffect, type RefObject } from 'react';

/**
 * Calls `handler` when a mousedown occurs outside of the referenced element.
 * No-op when `enabled` is false — useful for dropdowns that only need to
 * listen while open. Extracted from the repeated dropdown/menu click-outside
 * pattern used across modules.
 */
export function useClickOutside<T extends HTMLElement = HTMLElement>(
  ref: RefObject<T>,
  handler: (event: MouseEvent) => void,
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled) return;
    const listener = (e: MouseEvent) => {
      const el = ref.current;
      if (!el || el.contains(e.target as Node)) return;
      handler(e);
    };
    document.addEventListener('mousedown', listener);
    return () => document.removeEventListener('mousedown', listener);
  }, [ref, handler, enabled]);
}

export default useClickOutside;
