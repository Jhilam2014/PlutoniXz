import fs from "node:fs";
import http from "node:http";

function socketPath() {
  return process.env.DOCKER_SOCKET_PATH || "/var/run/docker.sock";
}

export function hasDockerSocket() {
  return fs.existsSync(socketPath());
}

export function dockerRequest(pathname, options = {}) {
  const method = options.method || "GET";
  const payload = options.body === undefined ? null : Buffer.from(JSON.stringify(options.body));
  const acceptedStatuses = options.acceptedStatuses || null;

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        socketPath: socketPath(),
        path: pathname,
        method,
        headers: payload
          ? {
              "Content-Type": "application/json",
              "Content-Length": payload.length
            }
          : undefined
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          const accepted = acceptedStatuses
            ? acceptedStatuses.includes(res.statusCode)
            : res.statusCode >= 200 && res.statusCode < 300;
          if (!accepted) {
            reject(new Error(`Docker API ${method} ${pathname} failed with ${res.statusCode}: ${body}`));
            return;
          }
          resolve({ statusCode: res.statusCode, body });
        });
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

export async function inspectContainer(containerName) {
  const response = await dockerRequest(`/containers/${encodeURIComponent(containerName)}/json`, {
    acceptedStatuses: [200, 404]
  });
  return response.statusCode === 404 ? null : JSON.parse(response.body);
}

export async function startContainer(containerName) {
  await dockerRequest(`/containers/${encodeURIComponent(containerName)}/start`, {
    method: "POST",
    acceptedStatuses: [204, 304]
  });
}

export async function stopContainer(containerName) {
  await dockerRequest(`/containers/${encodeURIComponent(containerName)}/stop`, {
    method: "POST",
    acceptedStatuses: [204, 304]
  });
}

export async function createContainer(containerName, configuration) {
  const response = await dockerRequest(`/containers/create?name=${encodeURIComponent(containerName)}`, {
    method: "POST",
    body: configuration,
    acceptedStatuses: [201]
  });
  return JSON.parse(response.body);
}

export async function removeContainer(containerName) {
  await dockerRequest(`/containers/${encodeURIComponent(containerName)}?force=true`, {
    method: "DELETE",
    acceptedStatuses: [204, 404]
  });
}

export async function containerLogs(containerName, tail = 80) {
  const response = await dockerRequest(
    `/containers/${encodeURIComponent(containerName)}/logs?stdout=true&stderr=true&tail=${encodeURIComponent(String(tail))}`,
    { acceptedStatuses: [200, 404] }
  );
  return response.statusCode === 404 ? "" : response.body;
}

export async function listContainers() {
  const response = await dockerRequest("/containers/json?all=true");
  return JSON.parse(response.body || "[]");
}

export async function listVolumes() {
  const response = await dockerRequest("/volumes");
  return JSON.parse(response.body || "{}").Volumes || [];
}

export async function removeVolume(volumeName) {
  await dockerRequest(`/volumes/${encodeURIComponent(volumeName)}?force=true`, {
    method: "DELETE",
    acceptedStatuses: [204, 404]
  });
}

export async function listNetworks() {
  const response = await dockerRequest("/networks");
  return JSON.parse(response.body || "[]");
}

export async function removeNetwork(networkId) {
  await dockerRequest(`/networks/${encodeURIComponent(networkId)}`, {
    method: "DELETE",
    acceptedStatuses: [204, 404]
  });
}
