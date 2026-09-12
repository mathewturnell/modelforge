import {useCallback, useEffect, useRef, useState} from "react";

export function useRequest<T>(loader: () => Promise<T>, dependencies: unknown[] = [], immediate = true) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(immediate);
  const sequence = useRef(0);

  const reload = useCallback(async () => {
    const requestId = ++sequence.current;
    setLoading(true);
    setError("");
    try {
      const result = await loader();
      if (requestId === sequence.current) setData(result);
      return result;
    } catch (reason) {
      if (requestId === sequence.current) setError(reason instanceof Error ? reason.message : String(reason));
      return null;
    } finally {
      if (requestId === sequence.current) setLoading(false);
    }
  }, dependencies); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (immediate) void reload();
    return () => { sequence.current += 1; };
  }, [reload, immediate]);

  return {data, setData, error, setError, loading, reload};
}
