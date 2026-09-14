export type StorageArea = "local" | "session";

function getStorage(area: StorageArea): Storage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return area === "session" ? window.sessionStorage : window.localStorage;
  } catch {
    return undefined;
  }
}

function removeStoredValue(key: string, area: StorageArea) {
  try { getStorage(area)?.removeItem(key); } catch { /* best effort */ }
}

export function readStoredJson<T>(key: string, decode: (value: unknown) => T | undefined, fallback: T, area: StorageArea = "local"): T {
  const storage = getStorage(area);
  if (!storage) return fallback;
  let raw: string | null;
  try { raw = storage.getItem(key); } catch { return fallback; }
  if (raw === null) return fallback;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    removeStoredValue(key, area);
    return fallback;
  }
  let decoded: T | undefined;
  try { decoded = decode(parsed); } catch { decoded = undefined; }
  if (decoded === undefined) {
    removeStoredValue(key, area);
    return fallback;
  }
  try {
    const normalized = JSON.stringify(decoded);
    if (normalized !== undefined) storage.setItem(key, normalized);
  } catch { /* best effort */ }
  return decoded;
}

export function writeStoredJson<T>(key: string, value: T, area: StorageArea = "local") {
  try {
    const encoded = JSON.stringify(value);
    if (encoded !== undefined) getStorage(area)?.setItem(key, encoded);
  } catch { /* best effort */ }
}

function decodeStringList(value: unknown, maxItems: number): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const recent = value.slice(-maxItems);
  if (recent.some((item) => typeof item !== "string" || item.length === 0 || item.length > 200)) return undefined;
  return [...new Set(recent)].slice(-maxItems);
}

export function readStoredStringList(key: string, maxItems: number): string[] {
  return readStoredJson(key, (value) => decodeStringList(value, maxItems), [], "local");
}

export function writeStoredStringList(key: string, values: string[], maxItems: number) {
  const normalized = decodeStringList(values, maxItems);
  if (normalized) writeStoredJson(key, normalized, "local");
}
