import { useCallback, useEffect, useRef, useState } from "react";

export interface AsyncState<T> {
   data: T | undefined;
   error: Error | undefined;
   loading: boolean;
   reload: () => void;
   setData: (updater: T | ((current: T | undefined) => T | undefined)) => void;
}

export function useAsync<T>(
   fn: () => Promise<T>,
   deps: readonly unknown[],
   options: { pollMs?: number } = {},
): AsyncState<T> {
   const [data, setDataState] = useState<T | undefined>(undefined);
   const [error, setError] = useState<Error | undefined>(undefined);
   const [loading, setLoading] = useState(true);
   const fnRef = useRef(fn);
   fnRef.current = fn;
   const [tick, setTick] = useState(0);

   const reload = useCallback(() => setTick((current) => current + 1), []);

   useEffect(() => {
      let cancelled = false;
      setLoading(true);
      fnRef
         .current()
         .then((value) => {
               if (cancelled) return;
               setDataState(value);
               setError(undefined);
                  })
         .catch((err: unknown) => {
               if (cancelled) return;
               setError(err instanceof Error ? err : new Error(String(err)));
                  })
         .finally(() => {
               if (!cancelled) setLoading(false);
                  });
      return () => {
            cancelled = true;
                  };
         }, [...deps, tick]);

   const pollMs = options.pollMs ?? 0;
   useEffect(() => {
      if (pollMs <= 0) return;
      const handle = setInterval(() => setTick((current) => current + 1), pollMs);
      return () => clearInterval(handle);
         }, [pollMs]);

   const setData = useCallback((updater: T | ((current: T | undefined) => T | undefined)) => {
      setDataState((current) =>
            typeof updater === "function" ? (updater as (c: T | undefined) => T | undefined)(current) : updater,
               );
         }, []);

   return { data, error, loading, reload, setData };
}
