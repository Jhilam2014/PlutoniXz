import { listProjects } from "../projectManager.js";

export async function listDeployableProjects() {
  const projects = await listProjects();
  return projects.filter((project) => !project.isDefault);
}
