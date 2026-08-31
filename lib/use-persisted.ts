"use client";

import { useEffect, useState } from "react";

/**
 * useState persisted to localStorage (local-only app: the browser is the
 * database). SSR/first paint renders `initial`; the stored value hydrates in
 * an effect to avoid hydration mismatch.
 */
export function usePersisted<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(initial);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    // Hydration from localStorage must happen post-mount (server has no
    // localStorage); this is the canonical read-on-mount effect.
    const load = () => {
      try {
              const raw = localStorage.getItem(key);
      if (raw != null) {
        const stored = JSON.parse(raw) as Record<string, unknown>;
        // One-level deep merge so newly added nested fields (member forms)
        // fall back to their defaults instead of becoming undefined.
        const base = initial as Record<string, unknown>;
        const merged: Record<string, unknown> = { ...base, ...stored };
        for (const k of Object.keys(base)) {
          const iv = base[k], sv = stored[k];
          if (
            iv != null && sv != null &&
            typeof iv === "object" && typeof sv === "object" &&
            !Array.isArray(iv) && !Array.isArray(sv)
          ) {
            merged[k] = { ...iv, ...sv };
          }
        }
        setValue(merged as T);
      }
      } catch {
        // Corrupt payload — start fresh.
      }
      setHydrated(true);
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (hydrated) localStorage.setItem(key, JSON.stringify(value));
  }, [key, value, hydrated]);

  return [value, setValue, hydrated] as const;
}
