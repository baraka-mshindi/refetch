import { headersToObject, mergeHeaders, setRequestHeader } from './headers.ts';
import type { RefetchInstance, RequestConfig } from './types.ts';

/**
 * A middleware takes an instance and returns a new one derived with `extend()`; the instance
 * passed in is never modified.
 */
type InstanceMiddleware = (instance: RefetchInstance) => RefetchInstance;

export interface AuthOptions {
  /**
   * Where the token may be sent. `'baseURL'` (default): only to the origin of the request's
   * base URL, so an absolute URL pointing elsewhere never receives it. An array lists the
   * allowed origins explicitly. `'any'` sends it everywhere.
   */
  origins?: 'baseURL' | 'any' | string[];
}

function originOf(url: string): string | undefined {
  try {
    // Relative base URLs resolve against the page in browsers.
    return new URL(url, globalThis.location?.href).origin;
  } catch {
    return undefined;
  }
}

/**
 * Injects `Authorization: Bearer <token>` into requests bound for an allowed origin (see
 * `AuthOptions.origins`). `getToken` is called per request so tokens are always fresh, and is
 * not called for requests that will not carry the token. An instance without a base URL has
 * no origin to scope to, so the default then attaches the token to every request.
 */
export function withAuth(
  getToken: () => string | Promise<string>,
  options: AuthOptions = {},
): InstanceMiddleware {
  const origins = options.origins ?? 'baseURL';
  return (parent) => {
    const instance = parent.extend();
    instance.interceptors.request.use(async (config: RequestConfig) => {
      // `||`, not `??`: must resolve the base exactly as the request path does, or an empty
      // per-request baseURL would turn scoping off while the instance base is still used.
      const base = config.baseURL || instance.getBaseURL();
      if (origins !== 'any' && (base || origins !== 'baseURL')) {
        const allowed = origins === 'baseURL' ? [originOf(base as string)] : origins.map(originOf);
        // Mirrors `buildUrl`: only an absolute http(s) URL leaves the base origin.
        const url = config.url ?? '';
        const absolute = url.startsWith('http://') || url.startsWith('https://');
        const target = originOf(absolute || !base ? url : base);
        if (!target || !allowed.includes(target)) return config;
      }
      return setRequestHeader(config, 'Authorization', `Bearer ${await getToken()}`);
    });
    return instance;
  };
}

/**
 * Overrides the timeout for all requests on this instance.
 */
export function withTimeout(ms: number): InstanceMiddleware {
  return (parent) => {
    const instance = parent.extend();
    instance.interceptors.request.use((config: RequestConfig) => ({
      ...config,
      timeout: ms,
    }));
    return instance;
  };
}

/**
 * Merges additional headers into every outgoing request.
 */
export function withHeaders(headers: HeadersInit): InstanceMiddleware {
  return (parent) => {
    const instance = parent.extend();
    instance.interceptors.request.use((config: RequestConfig) => ({
      ...config,
      headers: headersToObject(mergeHeaders(config.headers, headers)),
    }));
    return instance;
  };
}

/**
 * Overrides the base URL for all requests on this instance.
 */
export function withBaseURL(url: string): InstanceMiddleware {
  return (parent) => parent.extend({ baseURL: url });
}

/**
 * Logs every request and response via the supplied logger (defaults to `console`).
 */
export function withLogging(
  logger: Pick<Console, 'log' | 'warn' | 'error'> = console,
): InstanceMiddleware {
  return (parent) => {
    const instance = parent.extend();
    instance.interceptors.request.use((config: RequestConfig) => {
      logger.log(`[refetch] → ${config.method?.toUpperCase() ?? 'GET'} ${config.url}`);
      return config;
    });

    instance.interceptors.response.use((response) => {
      if (response.ok) {
        logger.log(`[refetch] ← ${response.status} (${response.duration}ms)`);
      } else {
        logger.warn(
          `[refetch] ← ${response.status ?? 'ERR'} ${response.problem} (${response.duration}ms)`,
        );
      }
      return response;
    });

    return instance;
  };
}
