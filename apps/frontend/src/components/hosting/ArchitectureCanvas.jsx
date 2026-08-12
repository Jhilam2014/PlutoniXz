import { useEffect, useRef } from "react";

function roundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

export default function ArchitectureCanvas({ project, provider, session }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scale = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(320, rect.width) * scale;
    canvas.height = 300 * scale;
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);
    ctx.clearRect(0, 0, rect.width, 300);

    const width = rect.width || 360;
    const nodes = [
      { x: 18, y: 36, w: 96, h: 58, title: "Project", body: project?.name || "Select project", color: "#0f766e" },
      { x: width / 2 - 48, y: 36, w: 96, h: 58, title: "Build", body: "Docker image", color: "#2563eb" },
      { x: width - 114, y: 36, w: 96, h: 58, title: "Registry", body: session?.deployment_plan?.image_registry || "Provider registry", color: "#7c3aed" },
      { x: width / 2 - 54, y: 136, w: 108, h: 62, title: "Runtime", body: provider?.name || "Cloud runtime", color: "#d97706" },
      { x: 18, y: 220, w: 96, h: 54, title: "Secrets", body: "Vault refs only", color: "#be123c" },
      { x: width - 114, y: 220, w: 96, h: 54, title: "Health", body: session?.deployment_plan?.health_check || "/", color: "#65a30d" }
    ];

    ctx.lineWidth = 2;
    ctx.strokeStyle = "#cbd5e1";
    const lines = [
      [nodes[0], nodes[1]],
      [nodes[1], nodes[2]],
      [nodes[2], nodes[3]],
      [nodes[4], nodes[3]],
      [nodes[3], nodes[5]]
    ];
    lines.forEach(([from, to]) => {
      ctx.beginPath();
      ctx.moveTo(from.x + from.w / 2, from.y + from.h / 2);
      ctx.lineTo(to.x + to.w / 2, to.y + to.h / 2);
      ctx.stroke();
    });

    nodes.forEach((node) => {
      roundedRect(ctx, node.x, node.y, node.w, node.h, 10);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.strokeStyle = node.color;
      ctx.stroke();
      ctx.fillStyle = node.color;
      ctx.font = "800 11px Inter, sans-serif";
      ctx.fillText(node.title, node.x + 10, node.y + 21);
      ctx.fillStyle = "#334155";
      ctx.font = "600 10px Inter, sans-serif";
      const body = String(node.body).slice(0, 20);
      ctx.fillText(body, node.x + 10, node.y + 40);
    });
  }, [project, provider, session]);

  return (
    <section className="hosting-side-card architecture-card">
      <h3>Architecture map</h3>
      <canvas ref={canvasRef} aria-label="Deployment architecture map" />
    </section>
  );
}
