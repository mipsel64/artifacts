export type ApiBody = Record<string, unknown> | unknown[] | string | number | boolean | null;

export async function api<T = unknown>(method: string, url: string, body?: ApiBody): Promise<T | null> {
  const headers: Record<string, string> = {};
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const response = await fetch(url, init);
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const result: unknown = await response.json();
      if (typeof result === 'object' && result !== null && 'error' in result && typeof result.error === 'string') {
        message = result.error;
      }
    } catch {}
    throw new Error(message);
  }
  return response.status === 204 ? null : ((await response.json()) as T);
}
