import { spawn } from "node:child_process";
import readline from "node:readline";

function safeMessage(value, fallback = "Codex account capability unavailable.") {
  const text = String(value || fallback)
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [REDACTED]")
    .replace(/\b(?:sk-|sess-|eyJ)[A-Za-z0-9._-]{8,}\b/g, "[REDACTED]")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, 320) || fallback;
}

function rpcFailure(response) {
  if (!response?.error) return null;
  return {
    code: Number.isFinite(Number(response.error.code)) ? Number(response.error.code) : null,
    message: safeMessage(response.error.message)
  };
}

export function probeCodexAccountUsage(codexBin = "codex", timeoutMs = 15_000, { spawnImpl = spawn } = {}) {
  const boundedTimeout = Math.max(2_000, Math.min(Number(timeoutMs) || 15_000, 20_000));
  return new Promise((resolve) => {
    let child;
    let lineReader;
    let settled = false;
    let initialized = false;
    let stderr = "";
    const responses = new Map();

    const stop = () => {
      try { lineReader?.close(); } catch {}
      try { child?.stdin?.end(); } catch {}
      try { child?.kill("SIGTERM"); } catch {}
    };

    const finish = (status, error = "") => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const accountResponse = responses.get(1);
      const limitsResponse = responses.get(2);
      const usageResponse = responses.get(3);
      const errors = [accountResponse, limitsResponse, usageResponse].map(rpcFailure).filter(Boolean);
      stop();
      resolve({
        available: initialized && Boolean(accountResponse?.result),
        status,
        account: accountResponse?.result || null,
        rateLimits: limitsResponse?.result || null,
        usage: usageResponse?.result || null,
        errors,
        error: error ? safeMessage(error) : errors.length ? errors.map((item) => item.message).join(" ").slice(0, 480) : null,
        observedAt: new Date().toISOString()
      });
    };

    const send = (message) => {
      try {
        child.stdin.write(`${JSON.stringify(message)}\n`);
      } catch (error) {
        finish("unavailable", error.message);
      }
    };

    const timer = setTimeout(() => finish(responses.size ? "partial" : "timeout", "Codex app-server account probe timed out."), boundedTimeout);
    timer.unref?.();

    try {
      child = spawnImpl(codexBin, ["app-server"], {
        stdio: ["pipe", "pipe", "pipe"],
        env: process.env,
        shell: false
      });
    } catch (error) {
      finish("unavailable", error.message);
      return;
    }

    child.stderr?.on("data", (chunk) => {
      stderr = `${stderr}${String(chunk || "")}`.slice(-2_000);
    });
    child.once("error", (error) => finish("unavailable", error.message));
    child.once("exit", (code) => {
      if (!settled) finish(responses.size ? "partial" : "unavailable", stderr || `Codex app-server exited with status ${code}.`);
    });

    lineReader = readline.createInterface({ input: child.stdout });
    lineReader.on("line", (line) => {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (message.id === 0) {
        if (message.error) {
          finish("unavailable", message.error.message);
          return;
        }
        initialized = true;
        send({ method: "initialized", params: {} });
        send({ method: "account/read", id: 1, params: { refreshToken: false } });
        send({ method: "account/rateLimits/read", id: 2, params: {} });
        send({ method: "account/usage/read", id: 3, params: {} });
        return;
      }
      if ([1, 2, 3].includes(message.id)) {
        responses.set(message.id, message);
        if (responses.size === 3) finish(responses.values().some((item) => item.error) ? "partial" : "available");
      }
    });

    send({
      method: "initialize",
      id: 0,
      params: {
        clientInfo: {
          name: "plutomix_gotham_account_usage",
          title: "PlutoMix Gotham Account & Usage",
          version: "1.0.0"
        }
      }
    });
  });
}
