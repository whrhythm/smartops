# AI-First Foundation Templates

This document defines the baseline templates for AI-driven agent development.

## Core principles

- AI orchestrator is the primary control plane entrypoint.
- Every capability is exposed as an atomic agent action.
- High-risk actions require approval before execution.
- Execution lifecycle is event-driven.
- Contracts are validated at registration and runtime.

## Backend templates

### 1) Agent contract

Path: `packages/backend/src/modules/agentPlatform/contracts/actionContract.ts`

- `agentDefinitionSchema`
- `agentActionSchema`
- `agentExecuteRequestSchema`

Use these schemas for all built-in and dynamic agents.

### 2) Approval contract

Path: `packages/backend/src/modules/agentPlatform/contracts/approvalContract.ts`

Use for approval ticket and decision payloads.

### 3) Event contract

Path: `packages/backend/src/modules/agentPlatform/contracts/eventContract.ts`

Use this envelope for all emitted events.

### 4) Event topics

Path: `packages/backend/src/modules/agentPlatform/events/topics.ts`

Current baseline topics:

- `task.planned`
- `task.started`
- `task.approval.required`
- `task.completed`
- `task.failed`
- `audit.appended`

### 5) Agent template helper

Path: `packages/backend/src/modules/agentPlatform/templates/createAgentTemplate.ts`

Use this helper to ensure action handlers and action definitions stay consistent.

## Runtime configuration

```
smartops:
  events:
    enabled: false
    mode: logger
    nats:
      serverUrl: nats://localhost:4222
      stream: SMARTOPS
      subjectPrefix: ""
```

`mode: logger` is default and safe for local development.

## Database foundation

Migration SQL is available at:

- `packages/backend/src/modules/agentPlatform/migrations/0001_smartops_foundation.sql`

It bootstraps tenant context, IAM mapping, license/quota, task execution,
approval, and audit tables under schema `smartops`.

## Implemented baseline

- Event publisher supports `logger` mode and `jetstream` mode.
- Agent task, approval, and audit persistence baseline is available via TaskStore.
- Approval decision API is available at:
  - `POST /api/agent-platform/approvals/:ticketId/decision`
  - Body: `{ "decision": "approved|rejected", "decidedBy": "<user>", "note": "..." }`
  - Approved decisions resume execution automatically.
- Query APIs:
  - `GET /api/agent-platform/tasks/:taskId`
  - `GET /api/agent-platform/tasks?tenantId=&status=&limit=`
  - `GET /api/agent-platform/approvals/:ticketId`
  - `GET /api/agent-platform/approvals?tenantId=&status=&limit=`
- Approval decision endpoint is idempotent: repeated decisions return current state
  and do not re-execute completed tasks.
- OTel phase-level spans are available for orchestration flows:
  - `plan`
  - `act`
  - `verify`
- LLM provider adapter layer is available in backend:
  - `openai-compatible` provider adapter
  - `ollama/local` provider adapter
  - Agent invocation is intentionally disabled in chat endpoints until agent workflows are production-ready.
- vCluster provisioning is abstracted behind provisioner drivers:
  - `helm` driver (GitOps commit mode for Helm values)
- Data Storage & Security agent baseline is available with actions:
  - `storage-tier-status`
  - `tenant-storage-quota`
  - `backup-plan-check`
  - `snapshot-create`
  - `restore-dry-run`
  - `backup-run-list`
  - `backup-run-get`
  - Integrations: Velero/OpenEBS/JuiceFS endpoints + Smart Storage DB tables

## Smart Storage framework

Smart Storage schema extension migration:

- `packages/backend/src/modules/agentPlatform/migrations/0002_smart_storage.sql`
- `packages/backend/src/modules/agentPlatform/migrations/0003_backup_runs_task_link.sql`

This migration adds baseline governance tables for tier policy, quota, backup,
and restore drill tracking.

`0003_backup_runs_task_link.sql` adds task/trace linking fields in backup runs
for cross-navigation between storage operations and agent task execution.

## Recommended next implementation steps

1. Add migration runner integration (currently SQL is manual apply).
2. Implement approval decision API and resume execution flow.
3. Persist identity mapping from IAM claims to `actor_id` UUID.
4. Add OTel spans for every task phase and agent action.
