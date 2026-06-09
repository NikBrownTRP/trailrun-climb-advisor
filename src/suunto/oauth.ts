import { OAUTH_AUTHORIZE_URL, OAUTH_TOKEN_URL, OAUTH_SCOPES } from "./constants";

export interface OAuthEnv {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  subscriptionKey: string; // Ocp-Apim-Subscription-Key
}

export function authorizeUrl(env: OAuthEnv, state: string): string {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: env.clientId,
    redirect_uri: env.redirectUri,
    scope: OAUTH_SCOPES,
    state,
  });
  return `${OAUTH_AUTHORIZE_URL}?${q.toString()}`;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user?: string; // Suunto user id [VERIFY field name]
}

export async function exchangeCode(env: OAuthEnv, code: string): Promise<TokenResponse> {
  return tokenRequest(env, { grant_type: "authorization_code", code, redirect_uri: env.redirectUri });
}

export async function refresh(env: OAuthEnv, refreshToken: string): Promise<TokenResponse> {
  return tokenRequest(env, { grant_type: "refresh_token", refresh_token: refreshToken });
}

async function tokenRequest(env: OAuthEnv, params: Record<string, string>): Promise<TokenResponse> {
  const body = new URLSearchParams({ client_id: env.clientId, client_secret: env.clientSecret, ...params });
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`OAuth token request failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as TokenResponse;
}
