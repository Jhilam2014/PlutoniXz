export const providers = [
  {
    id: "google-cloud-run",
    name: "Google Cloud Run",
    bestFor: "Simple MVP web/API apps with container deploys and scale-to-zero cost posture.",
    recommendation: "Default recommendation for simple generated web/API projects.",
    regions: ["asia-south1", "asia-southeast1", "us-central1", "europe-west1"],
    permissions: ["Cloud Run Developer", "Artifact Registry Writer", "Service Account User"],
    rollbackSupported: true
  },
  {
    id: "aws-apprunner",
    name: "AWS App Runner",
    bestFor: "AWS-first teams that want managed container hosting without ECS operations.",
    recommendation: "Recommended for AWS-first MVPs.",
    regions: ["ap-south-1", "ap-southeast-1", "us-east-1", "eu-west-1"],
    permissions: ["App Runner service access", "ECR push/pull", "IAM PassRole for deploy role"],
    rollbackSupported: true
  },
  {
    id: "aws-ecs-fargate",
    name: "AWS ECS Fargate",
    bestFor: "AWS-first apps needing more networking, service, or scaling control.",
    recommendation: "Use when App Runner is too limited.",
    regions: ["ap-south-1", "ap-southeast-1", "us-east-1", "eu-west-1"],
    permissions: ["ECS service update", "ECR push/pull", "IAM PassRole for task execution role"],
    rollbackSupported: true
  },
  {
    id: "azure-container-apps",
    name: "Azure Container Apps",
    bestFor: "Azure-first teams with managed container and revision support.",
    recommendation: "Recommended for Azure-first users.",
    regions: ["centralindia", "southeastasia", "eastus", "westeurope"],
    permissions: ["Container Apps Contributor", "ACR Push", "Managed Identity Operator"],
    rollbackSupported: true
  },
  {
    id: "custom-docker-host",
    name: "Custom Docker host",
    bestFor: "Existing VM or bare-metal Docker hosts managed by the user.",
    recommendation: "Use for custom infrastructure.",
    regions: ["self-managed"],
    permissions: ["SSH deploy user with Docker permissions"],
    rollbackSupported: true
  },
  {
    id: "kubernetes",
    name: "Kubernetes",
    bestFor: "Apps that truly need orchestration complexity, custom ingress, or cluster-native controls.",
    recommendation: "Not recommended by default.",
    regions: ["cluster-default"],
    permissions: ["Namespace-scoped deploy permissions", "Image registry push/pull"],
    rollbackSupported: true
  }
];

export function listProviders() {
  return providers;
}

export function getProvider(providerId) {
  return providers.find((provider) => provider.id === providerId) || providers[0];
}
