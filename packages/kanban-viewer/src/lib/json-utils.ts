export function safeJsonParse<T>(value: string | null | undefined): T | null {
  if (value === null || value === undefined) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}
