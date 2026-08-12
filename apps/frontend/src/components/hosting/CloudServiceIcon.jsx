const providerMarks = {
  "google-cloud-run": { label: "GCP", tone: "gcp" },
  "aws-apprunner": { label: "AWS", tone: "aws" },
  "aws-ecs-fargate": { label: "ECS", tone: "aws" },
  "azure-container-apps": { label: "AZ", tone: "azure" },
  "custom-docker-host": { label: "DKR", tone: "docker" },
  kubernetes: { label: "K8S", tone: "kubernetes" }
};

export default function CloudServiceIcon({ providerId, size = "medium" }) {
  const mark = providerMarks[providerId] || { label: "CLD", tone: "cloud" };
  return (
    <span className={`cloud-service-icon ${mark.tone} ${size}`} aria-hidden="true">
      <svg viewBox="0 0 32 32" focusable="false">
        <path d="M10.7 24.5h12.2a6 6 0 0 0 .6-12A8 8 0 0 0 8.2 10 6.8 6.8 0 0 0 10.7 24.5Z" />
      </svg>
      <b>{mark.label}</b>
    </span>
  );
}
