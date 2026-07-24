export function readStoredSortKey<T extends string>(
  storageKey: string,
  options: Array<{ key: T }>,
  fallback: T,
) {
  if (typeof window === "undefined") return fallback;
  try {
    const storedValue = window.localStorage.getItem(storageKey);
    return options.some((option) => option.key === storedValue) ? (storedValue as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeStoredSortKey(storageKey: string, value: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, value);
  } catch {
    // Sorting still works for the current session when browser storage is unavailable.
  }
}

export function timestampForSort(value: string) {
  if (value === "Just now") return Number.POSITIVE_INFINITY;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}
