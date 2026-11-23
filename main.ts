import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDossier } from "./vendor/makefun-game.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR || "/output";

mkdirSync(out, { recursive: true });
cpSync(join(here, "game"), join(out, "game"), { recursive: true });
cpSync(join(here, "screenshots"), join(out, "screenshots"), { recursive: true });

const options = {
  text_max_bytes: 163840,
  screenshots_max: 4,
  screenshots_max_bytes: 262144,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

const bytes = await buildDossier(out, options);
writeFileSync(join(out, "dossier.json"), bytes);
console.log("Wrote dossier to " + out);
