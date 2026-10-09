import type { Context, MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types';

const csp = (formAction: string) =>
  `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https://lh3.googleusercontent.com data:; frame-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action ${formAction}; frame-ancestors 'none'`;

export function setPageHeaders(c: Context<AppEnv>, formAction = "'self'") {
  c.header('Content-Security-Policy', csp(formAction));
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'same-origin');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Cache-Control', 'private, no-store');
}

export const pageHeaders: MiddlewareHandler<AppEnv> = async (c, next) => {
  setPageHeaders(c);
  await next();
};
