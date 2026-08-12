import fs from "node:fs";
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

function readEnvValue(filePath, key) {
  if (!fs.existsSync(filePath)) return "";
  const match = fs.readFileSync(filePath, "utf8").match(new RegExp(`^${key}=(.*)$`, "m"));
  return match?.[1]?.trim().replace(/^['"]|['"]$/g, "") || "";
}

function canonicalLocalhostPlugin() {
  return {
    name: "plutonix-canonical-localhost",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const host = req.headers.host || "";
        if (host.startsWith("127.0.0.1:")) {
          res.statusCode = 302;
          res.setHeader("Location", `http://localhost:${host.split(":")[1]}${req.url || "/"}`);
          res.end();
          return;
        }
        next();
      });
    }
  };
}

export default defineConfig(({ mode }) => {
  const envRoot =
    [path.resolve(__dirname, "../.."), path.resolve(__dirname, "..")]
      .find((candidate) => fs.existsSync(path.join(candidate, ".env")) || fs.existsSync(path.join(candidate, ".env.example"))) ||
    path.resolve(__dirname, "../..");
  const env = loadEnv(mode, envRoot, ["VITE_", "GOOGLE_CLIENT_ID"]);
  const examplePath = path.join(envRoot, ".env.example");
  const googleClientId =
    process.env.VITE_GOOGLE_CLIENT_ID ||
    process.env.GOOGLE_CLIENT_ID ||
    env.VITE_GOOGLE_CLIENT_ID ||
    env.GOOGLE_CLIENT_ID ||
    readEnvValue(examplePath, "VITE_GOOGLE_CLIENT_ID") ||
    readEnvValue(examplePath, "GOOGLE_CLIENT_ID");

  return {
    envDir: envRoot,
    base: process.env.PLUTONIX_DESKTOP_BUILD === "1" ? "./" : "/",
    define: {
      "import.meta.env.VITE_GOOGLE_CLIENT_ID": JSON.stringify(googleClientId),
      "import.meta.env.GOOGLE_CLIENT_ID": JSON.stringify(googleClientId)
    },
    plugins: [canonicalLocalhostPlugin(), react()],
    server: {
      host: "0.0.0.0",
      port: 5173
    }
  };
});
