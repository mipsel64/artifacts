export const origin = 'http://127.0.0.1:18787';
export const ownerEmail = 'owner@example.com';
export const reader = { id: 'google_fixture_reader', email: 'reader@example.com' };

export function sessionSecret() {
  const secret = process.env.ARTIFACTS_E2E_SESSION_SECRET;
  if (!secret) throw new Error('Run these tests through the Playwright configuration');
  return secret;
}
