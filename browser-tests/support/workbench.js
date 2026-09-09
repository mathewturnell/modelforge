import {spawn} from "node:child_process";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";

import {expect, test as base} from "@playwright/test";


const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const serverScript = path.join(repository, "browser-tests/fixtures/fixture_server.py");

async function waitForReady(port, child) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Fixture server exited with ${child.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/ready`);
      if (response.ok) return;
    } catch (_error) {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error("Fixture server did not become ready within 10 seconds");
}

async function waitForExit(child) {
  if (child.exitCode !== null) return;
  await Promise.race([
    new Promise(resolve => child.once("exit", resolve)),
    new Promise(resolve => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

class DisposableWorkbench {
  constructor(root) {
    this.root = root;
    this.stateRoot = path.join(root, "state");
    this.fixtureRoot = path.join(root, "fixtures");
    this.child = null;
    this.stderr = "";
    this.stdout = "";
    this.url = null;
  }

  async start(mode = "full") {
    if (this.child) throw new Error("Fixture server is already running");
    const python = process.env.MODELFORGE_TEST_PYTHON || "python3";
    const child = spawn(python, [serverScript, "--state-root", this.stateRoot, "--fixture-root", this.fixtureRoot, "--mode", mode], {
      cwd: repository,
      env: {...process.env, PYTHONNOUSERSITE: "1", PYTHONDONTWRITEBYTECODE: "1"},
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.child = child;
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", chunk => { this.stderr += chunk; });
    child.stdout.setEncoding("utf8");
    let carry = "";
    const ready = new Promise((resolve, reject) => {
      const onExit = code => reject(new Error(`Fixture server exited with ${code}: ${this.stderr}`));
      child.once("exit", onExit);
      child.stdout.on("data", chunk => {
        this.stdout += chunk;
        carry += chunk;
        const newline = carry.indexOf("\n");
        if (newline === -1) return;
        const line = carry.slice(0, newline);
        try {
          const value = JSON.parse(line);
          child.off("exit", onExit);
          resolve(value);
        } catch (error) {
          reject(new Error(`Fixture server emitted invalid startup JSON: ${error.message}`));
        }
      });
    });
    const value = await ready;
    this.url = value.url;
    this.port = value.port;
    await waitForReady(this.port, child);
    return this.url;
  }

  async stop() {
    if (!this.child) return;
    const child = this.child;
    this.child = null;
    child.kill("SIGTERM");
    await waitForExit(child);
  }

  async restart() {
    await this.stop();
    return this.start("existing");
  }
}

export const test = base.extend({
  workbench: async ({}, use, testInfo) => {
    const root = await mkdtemp(path.join(tmpdir(), "modelforge-public-browser-"));
    const workbench = new DisposableWorkbench(root);
    try {
      await use(workbench);
    } finally {
      await workbench.stop();
      if (testInfo.status !== testInfo.expectedStatus) {
        await testInfo.attach("fixture-server.log", {
          body: Buffer.from(`stdout:\n${workbench.stdout}\nstderr:\n${workbench.stderr}`),
          contentType: "text/plain",
        });
      }
      await rm(root, {recursive: true, force: true});
    }
  },
});

export {expect};
