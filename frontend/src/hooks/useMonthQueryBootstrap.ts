import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { fetchQueryBootstrap } from "../api/query";
import type { QueryBootstrap } from "../types/query";

export function useMonthQueryBootstrap(
  month: string,
  setBootstrap: Dispatch<SetStateAction<QueryBootstrap | null>>,
  onError?: (message: string) => void,
) {
  const previousMonth = useRef(month);
  const errorHandler = useRef(onError);
  errorHandler.current = onError;
  useEffect(() => {
    if (!month) return;
    let cancelled = false;
    if (previousMonth.current && previousMonth.current !== month) {
      setBootstrap((previous) => previous ? { ...previous, employees: [], departments: [] } : null);
    }
    previousMonth.current = month;
    fetchQueryBootstrap(month).then((payload) => {
      if (!cancelled) setBootstrap(payload);
    }).catch((error) => {
      if (!cancelled) errorHandler.current?.(error instanceof Error ? error.message : "月份资料加载失败");
    });
    return () => { cancelled = true; };
  }, [month, setBootstrap]);
}
