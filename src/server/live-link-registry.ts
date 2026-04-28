import { randomUUID } from "node:crypto";

export interface LiveLinkEntry {
  linkId: string;
  table: string;
  recordId: string;
  createdAt: number;
}

export interface LiveLinkRegistry {
  register(table: string, recordId: string): string;
  resolve(linkId: string): LiveLinkEntry | null;
  size: number;
}

const MAX_ENTRIES = 10000;
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function createLiveLinkRegistry(): LiveLinkRegistry {
  const store = new Map<string, LiveLinkEntry>();

  function evict(): void {
    const now = Date.now();
    for (const [id, entry] of store) {
      if (now - entry.createdAt > TTL_MS) {
        store.delete(id);
      }
    }
  }

  return {
    register(table: string, recordId: string): string {
      evict();
      if (store.size >= MAX_ENTRIES) {
        // Drop oldest entries
        const entries = [...store.entries()].sort(
          (a, b) => a[1].createdAt - b[1].createdAt,
        );
        for (let i = 0; i < Math.floor(MAX_ENTRIES * 0.1); i++) {
          const entry = entries[i];
        if (entry) store.delete(entry[0]);
        }
      }
      const linkId = `lnk_live_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
      store.set(linkId, {
        linkId,
        table,
        recordId,
        createdAt: Date.now(),
      });
      return linkId;
    },

    resolve(linkId: string): LiveLinkEntry | null {
      evict();
      return store.get(linkId) ?? null;
    },

    get size(): number {
      return store.size;
    },
  };
}

const defaultRegistry = createLiveLinkRegistry();

export function getLiveLinkRegistry(): LiveLinkRegistry {
  return defaultRegistry;
}
