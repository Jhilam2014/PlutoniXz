# Rollback Model

Mock-safe rollback marks the deployment as rolled back and writes a sanitized audit event.

Production providers should map this action to the safest native rollback primitive:

- Cloud Run revision traffic shift.
- App Runner previous service version or image.
- ECS Fargate previous task definition.
- Azure Container Apps revision rollback.
- Docker host previous image tag.
- Kubernetes previous rollout revision.
