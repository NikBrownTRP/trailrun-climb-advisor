// Suunto activity ids — CONFIRMED from real API workout data (github.com/tajchert/suuntool).
// running = 1, cycling = 2, hiking = 11, trail running = 22.
export const TRAIL_RUN_ACTIVITY_ID = 22;

export const CLOUD_API_BASE = "https://cloudapi.suunto.com";

// OAuth endpoints/scopes — CONFIRMED (apizone.suunto.com/how-to-start).
export const OAUTH_AUTHORIZE_URL = "https://cloudapi-oauth.suunto.com/oauth/authorize"; // CONFIRMED (apizone.suunto.com/how-to-start)
export const OAUTH_TOKEN_URL = "https://cloudapi-oauth.suunto.com/oauth/token"; // CONFIRMED (apizone.suunto.com/how-to-start)
export const OAUTH_SCOPES = "workout"; // CONFIRMED (apizone.suunto.com/how-to-start)
