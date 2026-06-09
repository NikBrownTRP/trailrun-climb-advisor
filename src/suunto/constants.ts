// GUESSED / [VERIFY] Suunto constants. Confirm against the developer portal/PDFs
// before production use (SPEC §3, §7, verification checklist §8).

// Trail-running activity id (SPEC: Activities.pdf [VERIFY]).
export const TRAIL_RUN_ACTIVITY_ID = 13; // placeholder — confirm in Activities.pdf

export const CLOUD_API_BASE = "https://cloudapi.suunto.com";

// OAuth endpoints/scopes — [VERIFY] at apizone.suunto.com/how-to-start.
export const OAUTH_AUTHORIZE_URL = "https://cloudapi-oauth.suunto.com/oauth/authorize";
export const OAUTH_TOKEN_URL = "https://cloudapi-oauth.suunto.com/oauth/token";
export const OAUTH_SCOPES = "workout"; // [VERIFY] exact scope strings
