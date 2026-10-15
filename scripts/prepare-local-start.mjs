import { ensureLocalEncryptionKey } from "./local-secrets.mjs";
import { readExecutionProfile } from "./execution-profile.mjs";
import { fileURLToPath } from "node:url";

if (readExecutionProfile() === "portable") {
  ensureLocalEncryptionKey();
  // The built Wrangler config is under dist/server, while local secrets live at
  // the project root. Pass an absolute path to avoid reading a stale build copy.
  process.argv.push(
    "--env-file",
    fileURLToPath(new URL("../.dev.vars", import.meta.url)),
  );
}
