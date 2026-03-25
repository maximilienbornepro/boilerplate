import { useEffect, useRef, useState, useCallback } from 'react';

interface FadeState {
  opacity: number;
  blur: number;
}

export function useScrollFade<T extends HTMLElement>(): [
  React.RefObject<T | null>,
  FadeState
] {
  const ref = useRef<T>(null);
  const [state, setState] = useState<FadeState>({ opacity: 1, blur: 0 });

  const updateVisibility = useCallback(() => {
    const element = ref.current;
    if (!element) return;

    // Find the scrollable parent
    const scrollParent = element.closest('[class*="reviewContent"]') as HTMLElement;
    if (!scrollParent) {
      setState({ opacity: 1, blur: 0 });
      return;
    }

    const containerRect = scrollParent.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();

    // Position relative to the scroll container
    const relativeTop = elementRect.top - containerRect.top;
    const relativeBottom = elementRect.bottom - containerRect.top;
    const containerHeight = containerRect.height;

    // Define the "focus zone" - the middle portion of the container
    const focusZoneStart = containerHeight * 0.15;
    const focusZoneEnd = containerHeight * 0.7;

    // Check if element is in the focus zone
    const elementCenter = relativeTop + elementRect.height / 2;

    let opacity = 1;
    let blur = 0;

    // Element is above focus zone
    if (elementCenter < focusZoneStart) {
      const distance = focusZoneStart - elementCenter;
      const maxDistance = focusZoneStart + elementRect.height;
      const progress = Math.min(distance / maxDistance, 1);
      opacity = Math.max(0.4, 1 - progress * 0.6);
      blur = progress * 1.5;
    }
    // Element is below focus zone
    else if (elementCenter > focusZoneEnd) {
      const distance = elementCenter - focusZoneEnd;
      const maxDistance = containerHeight - focusZoneEnd + elementRect.height;
      const progress = Math.min(distance / maxDistance, 1);
      opacity = Math.max(0.4, 1 - progress * 0.6);
      blur = progress * 1.5;
    }

    // Element completely out of view
    if (relativeBottom < 0 || relativeTop > containerHeight) {
      opacity = 0.3;
      blur = 2;
    }

    setState({ opacity, blur });
  }, []);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    // Find scrollable parent
    const scrollParent = element.closest('[class*="reviewContent"]') as HTMLElement;

    // Initial calculation after a small delay to ensure layout is ready
    const initialTimer = setTimeout(updateVisibility, 50);

    const handleScroll = () => {
      requestAnimationFrame(updateVisibility);
    };

    if (scrollParent) {
      scrollParent.addEventListener('scroll', handleScroll, { passive: true });
    }
    window.addEventListener('resize', handleScroll, { passive: true });

    return () => {
      clearTimeout(initialTimer);
      if (scrollParent) {
        scrollParent.removeEventListener('scroll', handleScroll);
      }
      window.removeEventListener('resize', handleScroll);
    };
  }, [updateVisibility]);

  return [ref, state];
}
