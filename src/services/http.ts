declare const Zotero: any;

export interface HttpTextOptions {
  headers?: Record<string, string>;
  timeout?: number;
  signal?: AbortSignal;
  retries?: number;
}

const HOST_COOLDOWN_MS = 5 * 60 * 1000;
const hostCooldowns = new Map<string, number>();

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

export function isHostBlocked(url: string, now = Date.now()): boolean {
  const host = hostOf(url);
  if (!host) return false;
  const until = hostCooldowns.get(host);
  if (!until) return false;
  if (now >= until) {
    hostCooldowns.delete(host);
    return false;
  }
  return true;
}

export function markHostBlocked(url: string, durationMs = HOST_COOLDOWN_MS, now = Date.now()): void {
  const host = hostOf(url);
  if (!host) return;
  hostCooldowns.set(host, now + durationMs);
}

export function clearHostCooldowns(): void {
  hostCooldowns.clear();
}

export function isChallengeBlockedHTML(html: string): boolean {
  if (!html || html.length > 350_000) return false;
  return /just a moment\.\.\.|cf-browser-verification|attention required!\s*\|\s*cloudflare|enable javascript and cookies to continue|verify you are human|captcha-delivery|px-captcha|access denied/i.test(
    html
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(retryAfterHeader: string | null | undefined, attempt: number): number {
  const sec = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : NaN;
  if (Number.isFinite(sec) && sec > 0 && sec <= 15) {
    return sec * 1000;
  }
  return Math.min(4000, 450 * Math.pow(2, attempt));
}

async function performRequest(
  method: 'GET' | 'POST',
  url: string,
  options: HttpTextOptions & { body?: string; defaultHeaders?: Record<string, string> }
): Promise<{ text: string; url: string; status: number }> {
  const headers = { ...(options.defaultHeaders || {}), ...(options.headers || {}) };
  const timeout = options.timeout || 25000;
  const maxRetries = options.retries ?? 2;

  for (let attempt = 0; ; attempt++) {
    if (typeof Zotero !== 'undefined' && Zotero?.HTTP?.request) {
      try {
        const xhr = await Zotero.HTTP.request(method, url, {
          ...(options.body !== undefined ? { body: options.body } : {}),
          headers,
          timeout,
        });
        return {
          text: String(xhr.responseText || ''),
          url: String(xhr.responseURL || url),
          status: Number(xhr.status || 200),
        };
      } catch (err: any) {
        const status = Number(err?.status || err?.xmlhttp?.status || 0);
        if ((status === 429 || status === 503) && attempt < maxRetries) {
          const retryAfter = err?.xmlhttp?.getResponseHeader?.('Retry-After');
          await sleep(retryDelayMs(retryAfter, attempt));
          continue;
        }
        if (status === 401 || status === 403 || status === 429) {
          markHostBlocked(url);
        }
        throw err;
      }
    }

    const ac = !options.signal && typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ac ? setTimeout(() => ac.abort(), timeout) : null;
    try {
      const resp = await fetch(url, {
        method,
        ...(options.body !== undefined ? { body: options.body } : {}),
        headers,
        signal: options.signal || ac?.signal,
      });
      if ((resp.status === 429 || resp.status === 503) && attempt < maxRetries) {
        await sleep(retryDelayMs(resp.headers?.get?.('retry-after'), attempt));
        continue;
      }
      if (!resp.ok) {
        if (resp.status === 401 || resp.status === 403 || resp.status === 429) {
          markHostBlocked(url);
        }
        throw new Error(`HTTP ${resp.status} for ${url}`);
      }
      return {
        text: await resp.text(),
        url: resp.url || url,
        status: resp.status,
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

export async function httpGetJSON<T = any>(url: string, options: HttpTextOptions = {}): Promise<T> {
  const res = await performRequest('GET', url, {
    ...options,
    defaultHeaders: { Accept: 'application/json' },
  });
  return JSON.parse(res.text) as T;
}

export async function httpPostJSON<T = any>(
  url: string,
  payload: unknown,
  options: HttpTextOptions = {}
): Promise<T> {
  const res = await performRequest('POST', url, {
    ...options,
    body: JSON.stringify(payload),
    defaultHeaders: {
      Accept: 'application/json',
      'Content-Type': 'application/json; charset=UTF-8',
    },
  });
  return JSON.parse(res.text) as T;
}

export async function httpGetText(url: string, options: HttpTextOptions = {}): Promise<string> {
  const res = await performRequest('GET', url, options);
  return res.text;
}

export async function httpGetHTML(
  url: string,
  options: HttpTextOptions = {}
): Promise<{ text: string; url: string }> {
  if (isHostBlocked(url)) {
    throw new Error(`Host temporarily skipped due to rate limit/challenge: ${url}`);
  }
  const res = await performRequest('GET', url, {
    timeout: options.timeout || 12000,
    retries: options.retries ?? 0,
    ...options,
    defaultHeaders: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });
  if (isChallengeBlockedHTML(res.text)) {
    markHostBlocked(res.url || url);
    throw new Error(`Publisher bot challenge detected for ${res.url || url}`);
  }
  return { text: res.text, url: res.url };
}

export async function httpPostForm(
  url: string,
  body: string,
  options: HttpTextOptions = {}
): Promise<string> {
  const res = await performRequest('POST', url, {
    ...options,
    body,
    defaultHeaders: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
    },
  });
  return res.text;
}

export function resolveURL(base: string, value: string | null | undefined): string {
  if (!value || /^data:/i.test(value)) {
    return '';
  }
  try {
    return new URL(String(value).replace(/&amp;/g, '&'), base).href;
  } catch {
    return '';
  }
}

export function uniqueURLs(urls: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of urls) {
    if (!url || seen.has(url)) {
      continue;
    }
    seen.add(url);
    out.push(url);
  }
  return out;
}
