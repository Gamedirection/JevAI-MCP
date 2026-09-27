import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

const FALLBACK_WIDTH = 720;

export function useElementWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
   const ref = useRef<T | null>(null);
   const [width, setWidth] = useState(FALLBACK_WIDTH);

   useEffect(() => {
      const element = ref.current;
      if (!element || typeof ResizeObserver === "undefined") return;
      const observer = new ResizeObserver((entries) => {
         for (const entry of entries) {
               const next = Math.round(entry.contentRect.width);
               if (next > 0) setWidth(next);
                     }
            });
      observer.observe(element);
      const initial = element.getBoundingClientRect().width;
      if (initial > 0) setWidth(Math.round(initial));
      return () => observer.disconnect();
          }, []);

   return [ref, width];
}
