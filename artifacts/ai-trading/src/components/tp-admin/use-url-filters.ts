import { useCallback } from "react";
import { useSearchParams } from "wouter";

/**
 * Filter halaman disimpan di query string supaya bisa dibagikan dan tetap ada
 * saat kembali dari halaman detail. Mengubah filter selain `page` me-reset page.
 */
export function useUrlFilters<K extends string>(keys: readonly K[]) {
  const [params, setParams] = useSearchParams();

  const values = Object.fromEntries(keys.map((key) => [key, params.get(key) ?? ""])) as Record<K, string>;

  const set = useCallback(
    (key: K, value: string) => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (value) next.set(key, value);
          else next.delete(key);
          if (key !== "page") next.delete("page");
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const reset = useCallback(() => setParams(new URLSearchParams(), { replace: true }), [setParams]);

  return { values, set, reset };
}
