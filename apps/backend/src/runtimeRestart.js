import http from "node:http";
import fs from "node:fs";

const socketPath = process.env.DOCKER_SOCKET_PATH || "/var/run/docker.sock";
const containerName = process.env.GENERATED_SITE_CONTAINER || "plutonix-generated-site";
const restartGeneratedContainer = String(process.env.RESTART_GENERATED_CONTAINER || "false").toLowerCase() === "true";

function dockerRequest(pathname, method = "GET") {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        socketPath,
        path: pathname,
        method
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ statusCode: res.statusCode, body });
          } else {
            reject(new Error(`Docker API ${method} ${pathname} failed with ${res.statusCode}: ${body}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

export async function restartGeneratedRuntime() {
  if (!restartGeneratedContainer) {
    return {
      status: "hot-reload",
      container: containerName,
      reason: "Generated-site container restart skipped; Vite hot reload is active for the generated app."
    };
  }

  if (!fs.existsSync(socketPath)) {
    return {
      status: "skipped",
      reason: `Docker socket not available at ${socketPath}`
    };
  }

  await dockerRequest(`/containers/${encodeURIComponent(containerName)}/restart?t=1`, "POST");
  return {
    status: "restarted",
    container: containerName
  };
}
