# Provider Permission Model

Provider permissions are previewed before credential onboarding. Users are warned against root, owner, billing administrator, or unrestricted admin credentials.

Default provider guidance:

- Google Cloud Run for simple MVP web/API apps.
- AWS App Runner for AWS-first managed container launches.
- AWS ECS Fargate when App Runner is too limited.
- Azure Container Apps for Azure-first teams.
- Custom Docker host for existing infrastructure.
- Kubernetes only when orchestration complexity is justified.
