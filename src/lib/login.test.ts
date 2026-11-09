import { afterEach, expect, it, vi } from "vitest";
import { verifyLogin } from "./login";
afterEach(() => vi.unstubAllEnvs());
it("never lets anonymous failed attempts lock out the valid password", () => {
  vi.stubEnv("OPENDOT_PASSWORD", "local-test-only-password");
  for (let i = 0; i < 12; i++) expect(() => verifyLogin("incorrect")).toThrow();
  expect(() => verifyLogin("local-test-only-password")).not.toThrow();
});
