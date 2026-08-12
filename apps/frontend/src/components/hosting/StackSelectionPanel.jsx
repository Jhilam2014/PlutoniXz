export default function StackSelectionPanel({ session, project, provider, onConfirm }) {
  const stack = session?.selected_stack || {
    runtime: "Node.js container",
    buildCommand: "npm install && npm run build",
    startCommand: "npm run preview -- --host 0.0.0.0",
    healthCheckPath: "/"
  };
  const boilerplate = [
    ["App type", "Generated React/Vite web app"],
    ["Runtime", stack.runtime],
    ["Container", "Node 22 slim production image"],
    ["Static assets", "Built from npm run build"],
    ["Health check", stack.healthCheckPath],
    ["Provider target", provider?.name || "Select provider"]
  ];
  return (
    <section className="hosting-side-card stack-boilerplate-card">
      <h3>Standard stack</h3>
      <p>{project ? `${project.name} will use a basic generated-app deployment profile.` : "Select a project to lock the stack profile."}</p>
      <dl>
        {boilerplate.map(([label, value]) => (
          <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
        ))}
      </dl>
      <div className="boilerplate-command-list">
        <span>Build</span>
        <code>{stack.buildCommand}</code>
        <span>Start</span>
        <code>{stack.startCommand}</code>
      </div>
      <button type="button" onClick={onConfirm}>Confirm stack</button>
    </section>
  );
}
