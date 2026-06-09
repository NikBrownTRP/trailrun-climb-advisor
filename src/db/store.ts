import Database from "better-sqlite3";
import { SCHEMA_SQL } from "./schema";
import type { Profile } from "../core/types";

export interface Tokens { accessToken: string; refreshToken: string; expiresAt: string; }

export class Store {
  private db: Database.Database;
  constructor(path = "data.db") {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA_SQL);
  }

  /** Insert the user if new, returning the local user id either way. */
  upsertUser(suuntoUserId: string): number {
    const insert = this.db
      .prepare(`INSERT INTO users(suunto_user_id) VALUES (?) ON CONFLICT(suunto_user_id) DO NOTHING`)
      .run(suuntoUserId);
    if (insert.changes > 0) return Number(insert.lastInsertRowid);
    const row = this.db
      .prepare(`SELECT id FROM users WHERE suunto_user_id = ?`)
      .get(suuntoUserId) as { id: number };
    return row.id;
  }

  setTokens(userId: number, t: Tokens): void {
    this.db.prepare(
      `INSERT INTO tokens(user_id, access_token, refresh_token, expires_at)
       VALUES (?,?,?,?)
       ON CONFLICT(user_id) DO UPDATE SET access_token=excluded.access_token,
         refresh_token=excluded.refresh_token, expires_at=excluded.expires_at`,
    ).run(userId, t.accessToken, t.refreshToken, t.expiresAt);
  }

  getTokens(userId: number): Tokens | undefined {
    const r = this.db.prepare(`SELECT access_token, refresh_token, expires_at FROM tokens WHERE user_id=?`).get(userId) as any;
    return r ? { accessToken: r.access_token, refreshToken: r.refresh_token, expiresAt: r.expires_at } : undefined;
  }

  setProfile(userId: number, p: Profile): void {
    this.db.prepare(
      `INSERT INTO profiles(user_id, json) VALUES (?,?)
       ON CONFLICT(user_id) DO UPDATE SET json=excluded.json`,
    ).run(userId, JSON.stringify(p));
  }

  getProfile(userId: number): Profile | undefined {
    const r = this.db.prepare(`SELECT json FROM profiles WHERE user_id=?`).get(userId) as any;
    return r ? (JSON.parse(r.json) as Profile) : undefined;
  }

  logGuide(userId: number, routeId: string, guideExternalId: string): void {
    this.db.prepare(
      `INSERT INTO guide_log(user_id, route_id, guide_external_id) VALUES (?,?,?)
       ON CONFLICT(user_id, route_id) DO UPDATE SET guide_external_id=excluded.guide_external_id,
         created_at=datetime('now')`,
    ).run(userId, routeId, guideExternalId);
  }
}
