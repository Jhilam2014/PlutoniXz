import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const candidates = [
  path.resolve(process.cwd(), "node_modules", "vite", "bin", "vite.js"),
  path.resolve(process.cwd(), "..", "..", "node_modules", "vite", "bin", "vite.js")
];

const viteBin = candidates.find((candidate) => fs.existsSync(candidate));

if (!viteBin) {
  console.error(`Unable to locate Vite. Checked:\n${candidates.map((candidate) => `- ${candidate}`).join("\n")}`);
  process.exit(1);
}

const child = spawn(process.execPath, [viteBin, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
