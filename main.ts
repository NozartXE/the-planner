// AMBER COAST — hand-in program for the gta6-01 entry (Node 22, standard library only).
//
// What the grader expects of this file, per the kit's RULES.txt and competition.yaml:
// the repository root holds the playable game as static files under game/ and three or
// four renders under screenshots/. Running this program assembles the submission in
// the output directory — /output on the grader, or $MAKEFUN_OUTPUT_DIR when that
// variable is set for a local dry run — by
//
//   1. copying game/ and screenshots/ across, byte for byte, and
//   2. writing dossier.json there with buildDossier from vendor/makefun-game.ts,
//      called with the scorer's own caps, so the dossier on disk is exactly the one
//      the sealed gate rebuilds and compares against.
//
// The copy is deliberately plain: a sorted recursive walk that copies regular files,
// recreates directories, and refuses anything else (a symlink inside game/ would fail
// the gate's game_files row, so it fails here first, with a clearer message). Any
// stale hand-in already sitting in the output directory is removed first, so two
// runs over the same repository always leave identical bytes behind. The file is
// written in the plain-JavaScript subset of TypeScript so `node --check` accepts it
// exactly as the node22 runtime runs it.

import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

// The scorer's caps (gate.json via the vendor library's header): only text_max_bytes
// shapes the dossier's bytes; the rest only refuse, and passing them here makes a
// local run fail in exactly the places the grader would refuse the entry.
const HAND_IN_CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 48 * 1024 * 1024,
  game_path_max_bytes: 1000,
};

const repoRoot = dirname(fileURLToPath(import.meta.url));
const outputDir = resolve(process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

// Every file under dir as a relative path, gathered in sorted order so the walk
// never depends on the order the filesystem happens to return names in.
function listEntries(dir, prefix, out) {
  for (const name of readdirSync(dir).sort()) {
    const rel = prefix === '' ? name : prefix + '/' + name;
    const stat = lstatSync(join(dir, name));
    if (stat.isSymbolicLink()) {
      throw new Error('hand-in refuses a symbolic link in the game tree: ' + rel);
    }
    if (stat.isDirectory()) listEntries(join(dir, name), rel, out);
    else if (stat.isFile()) out.push(rel);
    else throw new Error('hand-in refuses a non-file entry in the game tree: ' + rel);
  }
  return out;
}

// Copy one tree (game/ or screenshots/) from the repository into the output
// directory, replacing whatever a previous run left there. Returns the file count.
function stageTree(name) {
  const from = join(repoRoot, name);
  const into = join(outputDir, name);
  if (!existsSync(from)) throw new Error('hand-in needs ' + name + '/ in the repository, next to main.ts');
  rmSync(into, { recursive: true, force: true });
  mkdirSync(into, { recursive: true });
  const files = listEntries(from, '', []);
  for (const rel of files) {
    const target = join(into, rel);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(from, rel), target);
  }
  return files.length;
}

mkdirSync(outputDir, { recursive: true });
const gameFiles = stageTree('game');
const shotFiles = stageTree('screenshots');
rmSync(join(outputDir, 'dossier.json'), { force: true });

const dossier = buildDossier(outputDir, HAND_IN_CAPS);
writeFileSync(join(outputDir, 'dossier.json'), dossier);

console.log(
  'handed in ' + gameFiles + ' game files and ' + shotFiles + ' screenshots; dossier.json is ' +
    dossier.length + ' bytes in ' + outputDir,
);
