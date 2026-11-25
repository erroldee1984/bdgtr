/** Web version of storage.ts: the browser's localStorage (ids only, never secrets). */
export async function getItem(key: string): Promise<string | null> {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export async function setItem(key: string, value: string): Promise<void> {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    /* private mode / storage full: non-critical */
  }
}

export async function removeItem(key: string): Promise<void> {
  try {
    globalThis.localStorage?.removeItem(key);
  } catch {
    /* non-critical */
  }
}
