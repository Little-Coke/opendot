import { afterEach, expect, it, vi } from "vitest";
import {
  createSession,
  isAuthenticated,
  requireAccess,
  requireSameOrigin,
} from "./auth";
afterEach(() => vi.unstubAllEnvs());
it("rejects missing or tampered cookies and accepts a valid signed session", () => {
  vi.stubEnv("OPENDOT_PASSWORD", "local-test-password");
  expect(isAuthenticated(new Request("http://localhost/api/chat"))).toBe(false);
  const token = createSession();
  const request = (value: string) =>
    new Request("http://localhost/api/chat", {
      headers: { cookie: `opendot_session=${value}` },
    });
  expect(isAuthenticated(request(token))).toBe(true);
  expect(isAuthenticated(request(token + "bad"))).toBe(false);
  vi.stubEnv("OPENDOT_PASSWORD", "changed-password");
  expect(isAuthenticated(request(token))).toBe(false);
});
it("fails closed in production when a password is missing", () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("OPENDOT_PASSWORD", "");
  expect(() =>
    requireAccess(new Request("http://localhost/api/chat")),
  ).toThrow();
});
it("rejects cross-origin writes", () => {
  expect(() =>
    requireSameOrigin(
      new Request("https://app.example/api/chat", {
        headers: { origin: "https://evil.example" },
      }),
    ),
  ).toThrow();
  expect(() =>
    requireSameOrigin(
      new Request("https://app.example/api/chat", {
        headers: { origin: "https://app.example" },
      }),
    ),
  ).not.toThrow();
});
