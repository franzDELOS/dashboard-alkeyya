// In-memory access-token store for Phase 1. Deliberately NOT localStorage:
// the access token lives only in this module's closure for the tab's lifetime.
// A page refresh clears it and the dashboard silently re-mints one via the
// refresh-token cookie. Full client-side auth state management is a later phase.

let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}
