# Interactive Cloud Hosting

PlutoMix now includes a dedicated Cloud Hosting workspace tab for stage-based deployment conversations.

The assistant guides generated projects through project selection, deployment goal, provider selection, stack confirmation, region choice, credential method, permission preview, secure credential onboarding, deployment plan preview, approval, mock-safe execution, health check, result, rollback, and finalization.

The current implementation is intentionally mock-safe. It validates workflow state, writes sanitized audit events, and simulates deployment stages without mutating real cloud accounts.
