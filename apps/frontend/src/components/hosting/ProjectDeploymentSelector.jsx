export default function ProjectDeploymentSelector({ projects, selectedProjectId, onSelect }) {
  return (
    <label className="hosting-field">
      <span>Generated project</span>
      <select value={selectedProjectId || ""} onChange={(event) => onSelect(event.target.value)}>
        <option value="">Select project</option>
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name} : port {project.port}
          </option>
        ))}
      </select>
    </label>
  );
}
