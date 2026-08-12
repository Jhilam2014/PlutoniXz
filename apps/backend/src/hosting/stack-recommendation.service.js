export function recommendStack(project = {}, providerId = "google-cloud-run") {
  const isNode = true;
  return {
    id: "docker-node-web",
    runtime: isNode ? "Node.js container" : "Containerized web app",
    buildCommand: "npm install && npm run build",
    startCommand: "npm run preview -- --host 0.0.0.0",
    dockerfile: "Use project Dockerfile if present; otherwise build a Node 22 container.",
    registry: providerId === "google-cloud-run" ? "Artifact Registry" : providerId.startsWith("aws") ? "Amazon ECR" : providerId.startsWith("azure") ? "Azure Container Registry" : "Configured Docker registry",
    healthCheckPath: "/",
    notes: [`Project ${project.name || "selected app"} will deploy as a containerized web/API service.`]
  };
}
