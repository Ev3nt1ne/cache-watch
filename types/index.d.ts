/**
 * When the main conversation's last model request of this session was recorded
 * (ms since the epoch); null before the first one.
 *
 * Written twice per request: once as it goes out, once when its response is in.
 * The second write is the one the clock is meant to run from, because the API
 * writes the cache entry when the response completes.
 */
export type CacheWatchLastRequest = number | null

declare module 'claude-code' {
  interface PluginState {
    'cache-watch': {
      lastRequestAt: CacheWatchLastRequest
    }
  }
}
