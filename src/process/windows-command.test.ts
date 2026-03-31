import { describe, expect, it } from "vitest";
import { resolveWindowsCommandShim } from "./windows-command.js";

describe("resolveWindowsCommandShim", () => {
  it("leaves commands unchanged outside Windows", () => {
    expect(
      resolveWindowsCommandShim({
        command: "pnpm",
        cmdCommands: ["pnpm"],
        platform: "linux",
      }),
    ).toBe("pnpm");
  });

  it("appends .cmd for configured Windows shims", () => {
    expect(
      resolveWindowsCommandShim({
        command: "pnpm",
        cmdCommands: ["pnpm", "yarn"],
        platform: "win32",
      }),
    ).toBe("pnpm.cmd");
  });

  it("appends .cmd for gcloud on Windows", () => {
    expect(
      resolveWindowsCommandShim({
        command: "gcloud",
        cmdCommands: ["pnpm", "yarn", "gcloud"],
        platform: "win32",
      }),
    ).toBe("gcloud.cmd");
  });

  it("leaves gog unchanged on Windows (gogcli ships gog.exe)", () => {
    expect(
      resolveWindowsCommandShim({
        command: "gog",
        cmdCommands: ["pnpm", "yarn", "gcloud"],
        platform: "win32",
      }),
    ).toBe("gog");
  });

  it("keeps explicit extensions on Windows", () => {
    expect(
      resolveWindowsCommandShim({
        command: "npm.cmd",
        cmdCommands: ["npm", "npx"],
        platform: "win32",
      }),
    ).toBe("npm.cmd");
  });
});
