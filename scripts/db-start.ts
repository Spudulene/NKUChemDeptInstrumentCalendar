import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * One command from a cold machine to a migrated local database: starts Docker
 * Desktop if its engine isn't answering, waits for it, then does what `db:up` and
 * `db:deploy` do. Safe to re-run — every step is a no-op when already done.
 */

const ENGINE_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 2_000;

function engineIsUp(): boolean {
  return spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0;
}

function launchDockerDesktop(): void {
  if (process.platform === "win32") {
    const exe = path.join(
      process.env.ProgramFiles ?? "C:\\Program Files",
      "Docker",
      "Docker",
      "Docker Desktop.exe",
    );
    if (!existsSync(exe)) fail(`Docker Desktop not found at ${exe}.`);
    spawn(exe, [], { detached: true, stdio: "ignore" }).unref();
  } else if (process.platform === "darwin") {
    spawnSync("open", ["-a", "Docker"], { stdio: "inherit" });
  } else {
    fail("Start the Docker daemon (e.g. `sudo systemctl start docker`) and re-run.");
  }
}

async function waitForEngine(): Promise<void> {
  const deadline = Date.now() + ENGINE_TIMEOUT_MS;
  while (!engineIsUp()) {
    if (Date.now() > deadline) {
      fail(`Docker engine did not respond within ${ENGINE_TIMEOUT_MS / 1000}s.`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

function run(command: string): void {
  console.log(`> ${command}`);
  // shell: true so `npm` resolves to npm.cmd on Windows.
  const { status } = spawnSync(command, { stdio: "inherit", shell: true });
  if (status !== 0) fail(`\`${command}\` exited with ${status}.`);
}

function fail(message: string): never {
  console.error(`db:start: ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  if (!engineIsUp()) {
    console.log("Docker engine not running; starting Docker Desktop…");
    launchDockerDesktop();
    await waitForEngine();
    console.log("Docker engine is up.");
  }
  run("npm run db:up");
  run("npm run db:deploy");
}

main();
