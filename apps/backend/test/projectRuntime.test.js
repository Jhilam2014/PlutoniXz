import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { deleteProject, ensureProjectPreview, ensureProjectPreviewWithPortRetry, startProject, waitForProjectPreview } from "../src/projectManager.js";

async function findAvailablePort(start = 6200) {
  for (let port = start; port < start + 100; port += 1) {
    const server = net.createServer();
    try {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", resolve);
      });
      await new Promise((resolve) => server.close(resolve));
      return port;
    } catch {
      server.close();
    }
  }
  throw new Error(`No available test port found from ${start}.`);
}

test("treats Vite host-guard responses as a ready runtime", async (context) => {
  const server = http.createServer((_request, response) => {
    response.writeHead(403);
    response.end("Blocked request. This host is not allowed.");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();

  const ready = await waitForProjectPreview(
    { id: "vite-project", port: address.port },
    `http://127.0.0.1:${address.port}`,
    500
  );
  assert.equal(ready, true);
});

test("creates and starts a missing project container on its assigned port", async (context) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "plutonix-runtime-"));
  const socketPath = path.join(temporaryRoot, "docker.sock");
  const hostMoneyRoot = path.join(temporaryRoot, "money");
  await fs.mkdir(path.join(hostMoneyRoot, "demo"), { recursive: true });

  let containerCreated = false;
  let containerStarted = false;
  let startCount = 0;
  let removeCount = 0;
  let staleNetworkFailureOnce = false;
  let createConfiguration;
  const server = http.createServer((request, response) => {
    const requestPath = decodeURIComponent(request.url);
    if (request.method === "GET" && requestPath === "/containers/plutonix-backend/json") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          Config: { Image: "plutonix-backend:test" },
          Mounts: [{ Source: hostMoneyRoot, Destination: "/workspace/money" }],
          NetworkSettings: { Networks: { "plutonix_plutonix": {} } }
        })
      );
      return;
    }
    if (request.method === "GET" && requestPath === "/containers/plutonix-project-demo-abc123/json") {
      if (!containerCreated) {
        response.writeHead(404);
        response.end("not found");
        return;
      }
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          State: { Running: containerStarted },
          Config: { WorkingDir: "/workspace/money/demo" },
          HostConfig: { PortBindings: { "5307/tcp": [{ HostIp: "0.0.0.0", HostPort: "5307" }] } },
          Mounts: [
            {
              Type: "volume",
              Destination: "/workspace/money/demo/node_modules"
            }
          ]
        })
      );
      return;
    }
    if (request.method === "POST" && requestPath === "/containers/create?name=plutonix-project-demo-abc123") {
      let body = "";
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        createConfiguration = JSON.parse(body);
        containerCreated = true;
        response.writeHead(201, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ Id: "project-container" }));
      });
      return;
    }
    if (request.method === "POST" && requestPath === "/containers/plutonix-project-demo-abc123/start") {
      if (staleNetworkFailureOnce) {
        staleNetworkFailureOnce = false;
        response.writeHead(404);
        response.end('{"message":"failed to set up container networking: network d12d739ade0961f3bf36 not found"}');
        return;
      }
      containerStarted = true;
      startCount += 1;
      response.writeHead(204);
      response.end();
      return;
    }
    if (request.method === "DELETE" && requestPath === "/containers/plutonix-project-demo-abc123?force=true") {
      removeCount += 1;
      containerCreated = false;
      containerStarted = false;
      response.writeHead(204);
      response.end();
      return;
    }
    response.writeHead(500);
    response.end(`unexpected ${request.method} ${request.url}`);
  });

  await new Promise((resolve) => server.listen(socketPath, resolve));
  context.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });

  process.env.DOCKER_SOCKET_PATH = socketPath;
  process.env.PROJECT_RUNTIME_MODE = "docker";
  process.env.PLUTONIX_BACKEND_CONTAINER = "plutonix-backend";
  delete process.env.PROJECT_RUNTIME_IMAGE;
  delete process.env.PROJECT_RUNTIME_NETWORK;

  const runtime = await startProject({
    id: "demo-ABC123",
    name: "Demo",
    workspaceDir: "/workspace/money/demo",
    port: 5307
  });

  assert.equal(runtime.status, "created-and-started");
  assert.equal(runtime.containerName, "plutonix-project-demo-abc123");
  assert.equal(containerStarted, true);
  assert.equal(createConfiguration.Image, "plutonix-backend:test");
  assert.deepEqual(createConfiguration.HostConfig.PortBindings["5307/tcp"], [
    { HostIp: "0.0.0.0", HostPort: "5307" }
  ]);
  assert.deepEqual(createConfiguration.HostConfig.Binds, [
    `${path.join(hostMoneyRoot, "demo")}:/workspace/money/demo`
  ]);
  assert.deepEqual(createConfiguration.HostConfig.Mounts, [
    {
      Type: "volume",
      Source: "plutonix-project-demo-abc123-node-modules",
      Target: "/workspace/money/demo/node_modules"
    }
  ]);

  containerStarted = false;
  const recoveredRuntime = await startProject({
    id: "demo-ABC123",
    name: "Demo",
    workspaceDir: "/workspace/money/demo",
    port: 5307
  });
  assert.equal(recoveredRuntime.status, "restarted");
  assert.equal(startCount, 2);

  staleNetworkFailureOnce = true;
  containerStarted = false;
  const recoveryEvents = [];
  const networkRecoveredRuntime = await startProject(
    { id: "demo-ABC123", name: "Demo", workspaceDir: "/workspace/money/demo", port: 5307 },
    { emit: (type, message) => recoveryEvents.push({ type, message }) }
  );
  assert.equal(networkRecoveredRuntime.status, "network-recreated-and-started");
  assert.equal(removeCount, 1);
  assert.equal(recoveryEvents[0]?.type, "project-runtime-network-recovery");
});

test("does not reassign ports when a runtime starts but preview is not ready", async (context) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "plutonix-port-retry-"));
  const assignedPort = await findAvailablePort();
  const workspaceDir = path.join(temporaryRoot, "apps", "GeoBussinessFinderX");
  const registryPath = path.join(temporaryRoot, "runtime", "projects.json");
  await fs.mkdir(workspaceDir, { recursive: true });
  await fs.mkdir(path.dirname(registryPath), { recursive: true });
  await fs.writeFile(path.join(workspaceDir, "package.json"), JSON.stringify({ type: "module", scripts: { dev: "vite" } }));

  process.env.PROJECTS_REGISTRY_PATH = registryPath;
  process.env.PROJECTS_ROOT = path.join(temporaryRoot, "apps");
  process.env.PROJECT_RUNTIME_MODE = "process";
  process.env.PROJECT_PORT_START = String(assignedPort);
  process.env.PROJECT_PORT_END = String(assignedPort + 3);
  await fs.writeFile(
    registryPath,
    JSON.stringify(
      [
        {
          id: "geo-123",
          name: "GeoBussinessFinderX",
          folderName: "GeoBussinessFinderX",
          workspaceDir,
          port: assignedPort
        }
      ],
      null,
      2
    )
  );

  const fakeBinDir = path.join(temporaryRoot, "bin");
  await fs.mkdir(fakeBinDir, { recursive: true });
  await fs.writeFile(
    path.join(fakeBinDir, "npm"),
    [
      "#!/bin/sh",
      "for arg in \"$@\"; do port=\"$arg\"; done",
      `if [ "$port" = "${assignedPort + 1}" ]; then`,
      `  exec python3 -m http.server ${assignedPort + 1} --bind 127.0.0.1`,
      "fi",
      "exec sleep 120",
      ""
    ].join("\n")
  );
  await fs.chmod(path.join(fakeBinDir, "npm"), 0o755);
  const previousPath = process.env.PATH;
  process.env.PATH = `${fakeBinDir}:${previousPath}`;
  context.after(async () => {
    process.env.PATH = previousPath;
    try {
      await deleteProject("geo-123");
    } catch {
      // Best-effort cleanup for the fake preview process.
    }
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });

  const events = [];
  await assert.rejects(
    ensureProjectPreviewWithPortRetry(
      {
        id: "geo-123",
        name: "GeoBussinessFinderX",
        folderName: "GeoBussinessFinderX",
        workspaceDir,
        port: assignedPort
      },
      {
        maxAttempts: 2,
        previewTimeoutMs: 500,
        emit: (type, message, extra) => events.push({ type, message, extra })
      }
    ),
    new RegExp(`runtime process started on port ${assignedPort}`, "i")
  );
  assert.equal(events.length, 0);
  const registry = JSON.parse(await fs.readFile(registryPath, "utf8"));
  assert.equal(registry[0].port, assignedPort);
});

test("does not walk ports when the runtime process exits", async (context) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "plutonix-runtime-exit-"));
  const assignedPort = await findAvailablePort();
  const workspaceDir = path.join(temporaryRoot, "apps", "GeoFinderX");
  const registryPath = path.join(temporaryRoot, "runtime", "projects.json");
  await fs.mkdir(workspaceDir, { recursive: true });
  await fs.mkdir(path.dirname(registryPath), { recursive: true });
  await fs.writeFile(path.join(workspaceDir, "package.json"), JSON.stringify({ type: "module", scripts: { dev: "vite" } }));
  await fs.writeFile(
    registryPath,
    JSON.stringify([{ id: "geo-exit", name: "GeoFinderX", folderName: "GeoFinderX", workspaceDir, port: assignedPort }], null, 2)
  );

  const fakeBinDir = path.join(temporaryRoot, "bin");
  await fs.mkdir(fakeBinDir, { recursive: true });
  await fs.writeFile(path.join(fakeBinDir, "npm"), "#!/bin/sh\nexit 1\n");
  await fs.chmod(path.join(fakeBinDir, "npm"), 0o755);

  const previousPath = process.env.PATH;
  process.env.PATH = `${fakeBinDir}:${previousPath}`;
  process.env.PROJECTS_REGISTRY_PATH = registryPath;
  process.env.PROJECTS_ROOT = path.join(temporaryRoot, "apps");
  process.env.PROJECT_RUNTIME_MODE = "process";
  process.env.PROJECT_PORT_START = String(assignedPort);
  process.env.PROJECT_PORT_END = String(assignedPort + 3);
  context.after(async () => {
    process.env.PATH = previousPath;
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });

  await assert.rejects(
    ensureProjectPreviewWithPortRetry(
      { id: "geo-exit", name: "GeoFinderX", folderName: "GeoFinderX", workspaceDir, port: assignedPort },
      { maxAttempts: 4, previewTimeoutMs: 500 }
    ),
    new RegExp(`runtime process exited on port ${assignedPort}`, "i")
  );
  const registry = JSON.parse(await fs.readFile(registryPath, "utf8"));
  assert.equal(registry[0].port, assignedPort);
});

test("does not reassign ports for non-port Docker startup failures", async (context) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "plutonix-docker-non-port-"));
  const socketPath = path.join(temporaryRoot, "docker.sock");
  const hostMoneyRoot = path.join(temporaryRoot, "money");
  const workspaceDir = "/workspace/money/apps/GeoFindBusX";
  const registryPath = path.join(temporaryRoot, "runtime", "projects.json");
  await fs.mkdir(path.join(hostMoneyRoot, "apps", "GeoFindBusX"), { recursive: true });
  await fs.mkdir(path.dirname(registryPath), { recursive: true });
  await fs.writeFile(
    registryPath,
    JSON.stringify([{ id: "geo-docker", name: "GeoFindBusX", folderName: "GeoFindBusX", workspaceDir, port: 5300 }], null, 2)
  );

  let createAttempts = 0;
  const server = http.createServer((request, response) => {
    const requestPath = decodeURIComponent(request.url);
    if (request.method === "GET" && requestPath === "/containers/plutonix-backend/json") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          Config: { Image: "plutonix-backend:test" },
          Mounts: [{ Source: hostMoneyRoot, Destination: "/workspace/money" }],
          NetworkSettings: { Networks: { "plutonix_plutonix": {} } }
        })
      );
      return;
    }
    if (request.method === "GET" && requestPath === "/containers/plutonix-project-geo-docker/json") {
      response.writeHead(404);
      response.end("not found");
      return;
    }
    if (request.method === "POST" && requestPath === "/containers/create?name=plutonix-project-geo-docker") {
      createAttempts += 1;
      response.writeHead(500);
      response.end("image setup failed");
      return;
    }
    response.writeHead(500);
    response.end(`unexpected ${request.method} ${request.url}`);
  });

  await new Promise((resolve) => server.listen(socketPath, resolve));
  const previousEnvironment = {
    DOCKER_SOCKET_PATH: process.env.DOCKER_SOCKET_PATH,
    PROJECTS_REGISTRY_PATH: process.env.PROJECTS_REGISTRY_PATH,
    PROJECTS_ROOT: process.env.PROJECTS_ROOT,
    PROJECT_RUNTIME_MODE: process.env.PROJECT_RUNTIME_MODE,
    PLUTONIX_BACKEND_CONTAINER: process.env.PLUTONIX_BACKEND_CONTAINER,
    PROJECT_PORT_START: process.env.PROJECT_PORT_START,
    PROJECT_PORT_END: process.env.PROJECT_PORT_END
  };
  process.env.DOCKER_SOCKET_PATH = socketPath;
  process.env.PROJECTS_REGISTRY_PATH = registryPath;
  process.env.PROJECTS_ROOT = path.join(temporaryRoot, "apps");
  process.env.PROJECT_RUNTIME_MODE = "docker";
  process.env.PLUTONIX_BACKEND_CONTAINER = "plutonix-backend";
  process.env.PROJECT_PORT_START = "5300";
  process.env.PROJECT_PORT_END = "5303";
  context.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    for (const [key, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });

  const events = [];
  await assert.rejects(
    ensureProjectPreviewWithPortRetry(
      { id: "geo-docker", name: "GeoFindBusX", folderName: "GeoFindBusX", workspaceDir, port: 5300 },
      {
        maxAttempts: 4,
        previewTimeoutMs: 500,
        emit: (type, message, extra) => events.push({ type, message, extra })
      }
    ),
    /not a port allocation error/i
  );
  assert.equal(createAttempts, 1);
  assert.equal(events.some((event) => event.type === "project-port-reassigned"), false);
  const registry = JSON.parse(await fs.readFile(registryPath, "utf8"));
  assert.equal(registry[0].port, 5300);
});

test("allows project selection when runtime starts but backend preview probe times out", async (context) => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "plutonix-select-preview-timeout-"));
  const workspaceDir = path.join(temporaryRoot, "apps", "GeoFinderX");
  const registryPath = path.join(temporaryRoot, "runtime", "projects.json");
  await fs.mkdir(workspaceDir, { recursive: true });
  await fs.mkdir(path.dirname(registryPath), { recursive: true });
  await fs.writeFile(path.join(workspaceDir, "package.json"), JSON.stringify({ type: "module", scripts: { dev: "vite" } }));
  await fs.writeFile(
    registryPath,
    JSON.stringify([{ id: "geo-select-timeout", name: "GeoFinderX", folderName: "GeoFinderX", workspaceDir, port: 5398 }], null, 2)
  );

  const fakeBinDir = path.join(temporaryRoot, "bin");
  await fs.mkdir(fakeBinDir, { recursive: true });
  await fs.writeFile(path.join(fakeBinDir, "npm"), "#!/bin/sh\nexec sleep 120\n");
  await fs.chmod(path.join(fakeBinDir, "npm"), 0o755);

  const previousEnvironment = {
    PATH: process.env.PATH,
    PROJECT_RUNTIME_MODE: process.env.PROJECT_RUNTIME_MODE,
    PROJECT_HOST_URL: process.env.PROJECT_HOST_URL,
    PROJECTS_REGISTRY_PATH: process.env.PROJECTS_REGISTRY_PATH,
    PROJECTS_ROOT: process.env.PROJECTS_ROOT
  };
  process.env.PATH = `${fakeBinDir}:${previousEnvironment.PATH}`;
  process.env.PROJECT_RUNTIME_MODE = "process";
  process.env.PROJECT_HOST_URL = "http://localhost";
  process.env.PROJECTS_REGISTRY_PATH = registryPath;
  process.env.PROJECTS_ROOT = path.join(temporaryRoot, "apps");
  context.after(async () => {
    try {
      await deleteProject("geo-select-timeout");
    } catch {
      // Best-effort cleanup for the fake preview process.
    }
    process.env.PATH = previousEnvironment.PATH;
    if (previousEnvironment.PROJECT_RUNTIME_MODE === undefined) delete process.env.PROJECT_RUNTIME_MODE;
    else process.env.PROJECT_RUNTIME_MODE = previousEnvironment.PROJECT_RUNTIME_MODE;
    if (previousEnvironment.PROJECT_HOST_URL === undefined) delete process.env.PROJECT_HOST_URL;
    else process.env.PROJECT_HOST_URL = previousEnvironment.PROJECT_HOST_URL;
    if (previousEnvironment.PROJECTS_REGISTRY_PATH === undefined) delete process.env.PROJECTS_REGISTRY_PATH;
    else process.env.PROJECTS_REGISTRY_PATH = previousEnvironment.PROJECTS_REGISTRY_PATH;
    if (previousEnvironment.PROJECTS_ROOT === undefined) delete process.env.PROJECTS_ROOT;
    else process.env.PROJECTS_ROOT = previousEnvironment.PROJECTS_ROOT;
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });

  const project = await ensureProjectPreview(
    { id: "geo-select-timeout", name: "GeoFinderX", folderName: "GeoFinderX", workspaceDir, port: 5398 },
    { previewTimeoutMs: 100, allowPreviewTimeout: true }
  );

  assert.equal(project.id, "geo-select-timeout");
  assert.equal(project.previewUrl, "http://localhost:5398");
  assert.match(project.previewWarning, /Project preview did not become ready on port 5398/);
});
