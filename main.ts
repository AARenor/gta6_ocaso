import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildDossier } from "./vendor/makefun-game.ts";

const out = process.env.MAKEFUN_OUTPUT_DIR || "/output";
const root = process.cwd();

mkdirSync(out, { recursive: true });
cpSync(join(root, "game"), join(out, "game"), { recursive: true, force: true });
cpSync(join(root, "screenshots"), join(out, "screenshots"), { recursive: true, force: true });

const options = {
  text_max_bytes: 163840,
  screenshots: {
    max: 4,
    max_bytes: 262144,
  },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

const bytes = buildDossier(out, options);
writeFileSync(join(out, "dossier.json"), bytes);
console.log("Dossier written.");
