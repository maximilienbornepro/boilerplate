import { useCallback, type FormEvent } from 'react';

export function autoResizeElement(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

export function useAutoResize() {
  const autoResize = useCallback((el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }, []);

  const handleTextareaInput = useCallback((e: FormEvent<HTMLTextAreaElement>) => {
    autoResize(e.currentTarget);
  }, [autoResize]);

  return { autoResize, handleTextareaInput, autoResizeElement };
}
