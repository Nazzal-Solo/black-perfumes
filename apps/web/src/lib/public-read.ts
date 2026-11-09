export type PublicReadPolicy = { attempts: number; timeoutMs: number; backoffMs: number };
export const CATALOG_POLICY: PublicReadPolicy = { attempts: 4, timeoutMs: 20_000, backoffMs: 1_000 };
export const DETAIL_POLICY: PublicReadPolicy = { attempts: 3, timeoutMs: 15_000, backoffMs: 1_000 };
export class PublicReadError extends Error {
  constructor(public status: number) { super("The collection is temporarily unavailable."); }
}
const aborted = () => new DOMException("Catalog request cancelled", "AbortError");
function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(aborted()); return; }
    const finish = () => { signal.removeEventListener("abort", cancel); resolve(); };
    const timer = setTimeout(finish, ms);
    const cancel = () => { clearTimeout(timer); signal.removeEventListener("abort", cancel); reject(aborted()); };
    signal.addEventListener("abort", cancel, { once: true });
  });
}
type Flight = { controller: AbortController; promise: Promise<unknown>; users: number; settled: boolean };

// Only validated category data is cached. Products always re-check public visibility.
export function createPublicReader(fetcher: typeof fetch = fetch, now = Date.now) {
  const flights = new Map<string, Flight>();
  const categories = new Map<string, { value: unknown; expires: number }>();
  return async function read<T>(url: string, parse: (value: unknown) => T, options: { signal?: AbortSignal; categoryCache?: boolean; policy?: PublicReadPolicy } = {}): Promise<T> {
    const { signal, categoryCache = false, policy = CATALOG_POLICY } = options;
    if (signal?.aborted) throw aborted();
    const cached = categoryCache ? categories.get(url) : undefined;
    if (cached && cached.expires > now()) return cached.value as T;
    if (cached) categories.delete(url);
    const key = `${url}|${policy.attempts}|${policy.timeoutMs}|${policy.backoffMs}`;
    let flight = flights.get(key);
    if (!flight) {
      const controller = new AbortController();
      const perform = async () => {
        for (let attempt = 0; attempt < policy.attempts; attempt++) {
          try {
            const response = await fetcher(url, { cache: "no-store", credentials: "omit", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(policy.timeoutMs)]) });
            if (response.status === 404) return parse(null);
            if (!response.ok) { await response.body?.cancel(); throw new PublicReadError(response.status); }
            const value = parse(await response.json());
            if (categoryCache) categories.set(url, { value, expires: now() + 30_000 });
            return value;
          } catch (error) {
            if (controller.signal.aborted) throw aborted();
            const transient = error instanceof PublicReadError ? [502, 503, 504].includes(error.status) : error instanceof TypeError || (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name));
            if (!transient || attempt + 1 >= policy.attempts) throw error;
            await pause(policy.backoffMs * 2 ** attempt, controller.signal);
          }
        }
        throw new PublicReadError(503);
      };
      flight = { controller, promise: perform(), users: 0, settled: false };
      flights.set(key, flight);
      const current = flight;
      const settled = () => { current.settled = true; if (flights.get(key) === current) flights.delete(key); };
      void current.promise.then(settled, settled);
    }
    const current = flight; current.users++;
    return new Promise<T>((resolve, reject) => {
      let finished = false;
      const release = () => {
        finished = true; signal?.removeEventListener("abort", cancel); current.users--;
        if (!current.users && !current.settled) { if (flights.get(key) === current) flights.delete(key); current.controller.abort(); }
      };
      const cancel = () => { if (!finished) { release(); reject(aborted()); } };
      signal?.addEventListener("abort", cancel, { once: true });
      void current.promise.then(value => { if (!finished) { release(); resolve(value as T); } }, error => { if (!finished) { release(); reject(error); } });
      if (signal?.aborted) cancel();
    });
  };
}
