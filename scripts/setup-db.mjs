import "./sites-env.mjs";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

// Initial setup only. Existing installations apply only their pending migration.
const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"));
for (const entry of journal.entries) {
  const result = spawnSync(
    process.execPath,
    [
      "./node_modules/wrangler/bin/wrangler.js",
      "d1",
      "execute",
      "DB",
      "--local",
      "--config",
      "dist/server/wrangler.json",
      "--persist-to",
      ".wrangler/state",
      "--file",
      `drizzle/${entry.tag}.sql`,
    ],
    { stdio: "inherit", env: process.env },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
