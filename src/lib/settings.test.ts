import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { ChatStore } from "./chat-store";
import {
  readModelConfig,
  saveModelConfig,
  publicModelSettings,
} from "./settings";
let dir: string;
let store: ChatStore;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "opendot-settings-"));
  store = new ChatStore(dir);
});
afterEach(() => {
  store.db.close();
  rmSync(dir, { recursive: true, force: true });
});
it("encrypts the model credential and never projects it to the client", () => {
  const key = "test-only-provider-value";
  saveModelConfig(
    { baseUrl: "https://example.com/v1", model: "test-model", apiKey: key },
    store,
  );
  expect(readModelConfig(store, {}).apiKey).toBe(key);
  expect(publicModelSettings(store, {})).toEqual({
    baseUrl: "https://example.com/v1",
    model: "test-model",
    hasKey: true,
    source: "settings",
  });
  for (const file of readdirSync(dir))
    expect(readFileSync(join(dir, file)).includes(Buffer.from(key))).toBe(
      false,
    );
});
it("retains an existing key on blank edits and supports explicit removal", () => {
  saveModelConfig(
    { baseUrl: "https://example.com/v1", model: "one", apiKey: "test-value" },
    store,
  );
  saveModelConfig(
    { baseUrl: "https://example.com/v1", model: "two", apiKey: "" },
    store,
  );
  expect(readModelConfig(store, {}).apiKey).toBe("test-value");
  expect(
    readModelConfig(store, {
      OPENAI_API_KEY: "env-value",
      OPENAI_MODEL: "env-model",
    }),
  ).toMatchObject({ apiKey: "env-value", model: "env-model" });
  saveModelConfig(
    { baseUrl: "https://example.com/v1", model: "two", clearKey: true },
    store,
  );
  expect(publicModelSettings(store, {}).hasKey).toBe(false);
});
