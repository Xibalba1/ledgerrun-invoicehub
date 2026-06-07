import { execSync } from "node:child_process";

// The deterministic, offline gate bound to the project Stop hook. Only fast,
// network-free checks live here — typecheck, unit/eval-smoke tests, and web build. The LIVE
// LLM eval (npm run eval) is on-demand: it's networked and costs tokens, so it
// must never gate every Stop.
const steps: [string, string][] = [
  ["typecheck", "npm run typecheck"],
  ["tests", "npm test"],
  ["web build", "npm run build:web"],
];

for (const [name, cmd] of steps) {
  process.stdout.write(`\n▸ ${name}\n`);
  try {
    execSync(cmd, { stdio: "inherit" });
  } catch {
    process.stderr.write(`\n✗ verify failed at: ${name}\n`);
    process.exit(1);
  }
}
process.stdout.write("\n✓ verify passed (typecheck + tests + web build)\n");
