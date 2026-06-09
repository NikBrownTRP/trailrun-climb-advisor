import { describe, it, expect } from "vitest";
import { userFromAccessToken } from "../src/suunto/oauth";

// Build a fake JWT: header.payload.signature with base64 payload {"user":"alice@example.com"}
function fakeJwt(payload: object): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64");
  return `${b64({ alg: "none" })}.${b64(payload)}.sig`;
}

describe("userFromAccessToken", () => {
  it("extracts the `user` claim from a JWT", () => {
    expect(userFromAccessToken(fakeJwt({ user: "alice@example.com", scope: "workout" }))).toBe("alice@example.com");
  });
  it("throws on a non-JWT string", () => {
    expect(() => userFromAccessToken("not-a-jwt")).toThrow();
  });
  it("throws when the `user` claim is absent", () => {
    expect(() => userFromAccessToken(fakeJwt({ scope: "workout" }))).toThrow(/user/i);
  });
});
