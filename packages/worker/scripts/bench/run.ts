// arclight-bench orchestrator: runs the scenarios in order, writes results.json.
//   pnpm bench                          # all four scenarios
//   BENCH_SCENARIOS=freshness pnpm bench
// Output: docs/benchmarks/<YYYY-MM-DD>/results.json
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as freshness from './freshness.ts';
import * as backfill from './backfill.ts';
import * as burst from './burst.ts';
import * as visibility from './visibility.ts';

const ROOT = resolve(import.meta.dirname, '../../../..');
const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgres://arclight:arclight@localhost:5432/arclight';

const SCENARIOS: Record<string, () => Promise<unknown>> = {
  visibility: () => visibility.run(),
  freshness: () => freshness.run(DATABASE_URL),
  backfill: () => backfill.run(DATABASE_URL),
  burst: () => burst.run(DATABASE_URL),
};

async function main(): Promise<void> {
  const selected = (process.env['BENCH_SCENARIOS'] ?? Object.keys(SCENARIOS).join(','))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const s of selected) {
    if (!(s in SCENARIOS)) throw new Error(`unknown scenario: ${s}`);
  }

  const results: Record<string, unknown> = {
    meta: {
      date: new Date().toISOString(),
      gitSha: execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim(),
      node: process.version,
    },
  };

  let failed = false;
  for (const name of selected) {
    console.log(`\n=== scenario: ${name} ===`);
    const t0 = performance.now();
    try {
      results[name] = await SCENARIOS[name]!();
      console.log(`${name} done (${((performance.now() - t0) / 1000).toFixed(1)}s)`);
    } catch (err) {
      failed = true;
      const message = err instanceof Error ? err.message : String(err);
      results[name] = { error: message };
      console.error(`${name} FAILED: ${message}`);
    }
  }

  const day = new Date().toISOString().slice(0, 10);
  const outDir = join(ROOT, 'docs', 'benchmarks', day);
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'results.json');
  // merge with earlier runs from the same day — so scenarios can be run one at a time
  const previous = existsSync(outPath)
    ? (JSON.parse(readFileSync(outPath, 'utf8')) as Record<string, unknown>)
    : {};
  writeFileSync(outPath, JSON.stringify({ ...previous, ...results }, null, 2));
  console.log(`\nresults: ${outPath}`);
  if (failed) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
