import { useLayoutEffect, useState } from "react";

/**
 * Shrink content until it fits its container's height.
 *
 * Nobody scrolls a wall-mounted TV, so a session that overflows has to scale
 * down instead of falling below the fold. Never scales above 1 — short sessions
 * keep their designed type size.
 *
 * The scale is applied as a CSS transform, which does not affect layout, so
 * measuring `scrollHeight` always reads the natural (unscaled) height and the
 * observer can't feed back into itself.
 */
export function useFitScale<
  Container extends HTMLElement,
  Content extends HTMLElement
>(minScale = 0.4) {
  // Callback refs, not useRef: the board mounts only once session data arrives,
  // and a ref object assignment would never re-run the effect below.
  const [container, setContainer] = useState<Container | null>(null);
  const [content, setContent] = useState<Content | null>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    if (!container || !content) return;

    let frame = 0;

    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const available = container.clientHeight;
        const natural = content.scrollHeight;
        if (!available || !natural) return;

        const next = Math.max(minScale, Math.min(1, available / natural));
        // Ignore sub-pixel churn so the observer settles.
        setScale((current) => (Math.abs(current - next) < 0.005 ? current : next));
      });
    };

    const observer = new ResizeObserver(measure);
    observer.observe(container);
    observer.observe(content);
    measure();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [container, content, minScale]);

  return { containerRef: setContainer, contentRef: setContent, scale };
}
