import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

it("rolls back to the running image even when docker load already replaced the local tag", () => {
  const directory = mkdtempSync(join(tmpdir(), "opendot-deploy-"));
  const log = join(directory, "tags");
  try {
    const result = spawnSync(
      "bash",
      [
        "-c",
        `
      cd() { return 0; }
      sleep() { return 0; }
      curl() { echo '{"ok":true,"app":"opendot"}'; }
      sudo() {
        if [ "$1 $2" = "docker inspect" ]; then echo sha256:previous; return 0; fi
        if [ "$1 $2 $3" = "docker image inspect" ]; then echo sha256:new; return 0; fi
        if [ "$1 $2" = "docker tag" ]; then printf '%s %s\\n' "$3" "$4" >> "$TEST_TAG_LOG"; return 0; fi
        if [ "$1 $2" = "docker compose" ]; then return 1; fi
        return 0
      }
      export -f cd sleep curl sudo
      bash "$SCRIPT_PATH" "$DEPLOY_SHA"
    `,
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          TEST_TAG_LOG: log,
          SCRIPT_PATH: resolve("scripts/deploy-remote.sh"),
          DEPLOY_SHA: "a".repeat(40),
        },
      },
    );
    expect(result.status).toBe(1);
    const tags = readFileSync(log, "utf8");
    expect(tags).toContain("sha256:previous opendot:rollback");
    expect(tags).toContain("opendot:rollback opendot:local");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
