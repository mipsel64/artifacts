import { createSessionCookie } from '../src/auth';
import { sessionSecret } from './settings';

const [, , id, email] = process.argv;
if (!id || !email) throw new Error('Missing fixture identity');

const env = { SESSION_SECRET: sessionSecret() } as Parameters<typeof createSessionCookie>[0];
console.log(await createSessionCookie(env, { id, email }));
