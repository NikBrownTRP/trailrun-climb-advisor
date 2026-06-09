import Fastify from "fastify";
import formbody from "@fastify/formbody";
import { readFileSync } from "node:fs";
import { Store } from "../db/store";
import { authorizeUrl, exchangeCode, userFromAccessToken, type OAuthEnv } from "../suunto/oauth";
import { exportRouteGpx } from "../suunto/routes";
import { upsertGuideForRoute } from "../suunto/guideCloud";
import { generateGuideFromGpx } from "../pipeline";
import type { Profile } from "../core/types";

export interface ServerDeps { store: Store; oauth: OAuthEnv; subscriptionKey: string; }

export function buildApp(deps: ServerDeps) {
  const app = Fastify({ logger: true });
  app.register(formbody);

  app.get("/health", async () => ({ ok: true }));

  // --- OAuth connect ---
  app.get("/connect", async (_req, reply) => {
    reply.type("text/html").send(readFileSync("src/web/connect.html", "utf8"));
  });

  app.get("/oauth/start", async (req, reply) => {
    reply.redirect(authorizeUrl(deps.oauth, "state-" + req.id));
  });

  app.get<{ Querystring: { code?: string } }>("/oauth/callback", async (req, reply) => {
    const code = req.query.code;
    if (!code) return reply.code(400).send("missing code");
    const tok = await exchangeCode(deps.oauth, code);
    // NOTE (v1): the OAuth `state` param is generated in /oauth/start but not verified here.
    // CSRF-hardening the callback requires server-side state storage; deferred to a follow-up.
    let suuntoUser: string;
    try {
      suuntoUser = userFromAccessToken(tok.access_token); // `user` claim inside the JWT
    } catch (err) {
      return reply.code(502).send("Could not read user from Suunto access token: " + (err as Error).message);
    }
    const userId = deps.store.upsertUser(suuntoUser);
    deps.store.setTokens(userId, {
      accessToken: tok.access_token, refreshToken: tok.refresh_token,
      expiresAt: new Date(Date.now() + tok.expires_in * 1000).toISOString(),
    });
    reply.redirect(`/profile?user=${userId}`);
  });

  // --- Profile form ---
  app.get<{ Querystring: { user?: string } }>("/profile", async (_req, reply) => {
    reply.type("text/html").send(readFileSync("src/web/profile.html", "utf8"));
  });

  app.post<{ Body: Record<string, string> }>("/profile", async (req, reply) => {
    const b = req.body;
    const userId = Number(b.user);
    if (!Number.isInteger(userId) || userId <= 0) {
      return reply.code(400).send("invalid or missing user id");
    }
    const profile: Profile = {
      vo2max: Number(b.vo2max), thresholdHR: Number(b.thresholdHR), maxHR: Number(b.maxHR),
      restHR: Number(b.restHR), bodyMass: Number(b.bodyMass),
      hasPoles: b.hasPoles === "on" || b.hasPoles === "true",
      experience: b.experience as Profile["experience"], goal: b.goal as Profile["goal"],
    };
    deps.store.setProfile(userId, profile);
    reply.type("text/html").send("<p>Profile saved. Plan a route in the Suunto app — your guide will generate automatically.</p>");
  });

  // --- Route webhook ---
  app.post<{ Body: { type?: string; username?: string; route?: { id?: string; name?: string } } }>(
    "/webhook/route",
    async (req, reply) => {
      const username = req.body.username;
      if (!username) return reply.code(400).send("missing username");
      const userId = deps.store.getUserIdBySuuntoId(username);
      if (!userId) return reply.code(409).send("user not set up");
      const routeId = req.body.route?.id;
      const routeName = req.body.route?.name ?? "Route";
      if (!routeId) return reply.code(400).send("missing route id");

      const profile = deps.store.getProfile(userId);
      const tokens = deps.store.getTokens(userId);
      if (!profile || !tokens) return reply.code(409).send("user not set up");

      const auth = { accessToken: tokens.accessToken, subscriptionKey: deps.subscriptionKey };
      try {
        const gpx = await exportRouteGpx(auth, routeId);
        const { guide, zip } = await generateGuideFromGpx(gpx, profile, { routeId, routeName });
        await upsertGuideForRoute(auth, routeId, zip);
        deps.store.logGuide(userId, routeId, guide.externalId!);
        return reply.send({ ok: true, climbs: guide.steps.length / 2 });
      } catch (err) {
        req.log.error({ err, routeId }, "guide generation failed");
        return reply.code(500).send({ ok: false, error: (err as Error).message });
      }
    },
  );

  return app;
}
