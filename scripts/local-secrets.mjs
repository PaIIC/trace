import { randomBytes } from "node:crypto";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Run before Wrangler reads .dev.vars. Never send this wrapping key to the client.
export function ensureLocalEncryptionKey(
  root = fileURLToPath(new URL("../", import.meta.url)),
  environment = process.env,
) {
  const file = path.join(root, ".dev.vars");
  let source = "";
  try {
    source = readFileSync(file, "utf8");
    chmodSync(file, 0o600);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  // Preserve any existing assignment, including an invalid one: silently rotating
  // a wrapping key would make previously saved connections unreadable.
  if (/^\s*AI_SETTINGS_ENCRYPTION_KEY\s*=/m.test(source)) {
    return;
  }
  const secret =
    environment.AI_SETTINGS_ENCRYPTION_KEY || randomBytes(32).toString("hex");
  if (!/^[0-9a-f]{64}$/i.test(secret))
    throw new Error(
      "AI_SETTINGS_ENCRYPTION_KEY must contain 64 hexadecimal characters.",
    );
  const line = `\n# Automatically generated; keep this key with your database backup.\nAI_SETTINGS_ENCRYPTION_KEY="${secret}"\n`;
  writeFileSync(file, source + line, { mode: 0o600 });
}
