# MODULAR-BACKEND.md

Guidance for AI coding agents writing backend code in this repo.

The backend should be modular, explicit, and easy to reason about. Keep business logic out of route handlers, keep data access behind clear boundaries, and make the system simple to extend when the product grows.

Given examples are of a specific framework, take the structure as a guidance. framework can change.

## Core Principles

- Routes should handle HTTP concerns only.
- Services should contain business logic.
- Repositories should contain persistence logic.
- Schemas should validate inputs and outputs.
- Types should describe domain objects clearly.
- Config should be centralized.
- Errors should be intentional and consistent.

Do not build a large abstraction layer before the product needs it. Build small, obvious modules with clean boundaries.

## Recommended Structure

This is an example of a TS Backend - but the same applies for any other framework :

```txt
src/
  global/
    config.ts
    errors.ts
    logger.ts
    global-utils.ts
    types.ts
  modules/
    module-name/
      module-name.routes.ts
      module-name.controller.ts
      module-name.service.ts
      module-name.repository.ts
      module-name.schema.ts
      module-name.types.ts
      module-name.utils.ts
      module-name.test.ts
      index.ts
  middleware/
    auth.middleware.ts
    error.middleware.ts
    request-logging.middleware.ts
  services/
    external-service-name.ts
  db/
    client.ts
    schema.ts
    migrations/
  app.ts
  server.ts
```

For smaller interview builds, this can be simplified:

```txt
src/
  global/
  modules/
    adoption/
    tools/
    interventions/
  app.ts
  server.ts
```

Keep feature code inside `modules/<module-name>/`. Shared cross-cutting utilities belong in `global/`.

## Route Layer

Routes should define HTTP paths and connect them to controllers.

Routes may handle:

- URL structure
- HTTP method
- Middleware attachment
- Request parameter passing

Routes should not contain:

- Business decisions
- Database queries
- Scoring logic
- Long validation blocks
- Response shaping beyond calling the controller

Example:

```ts
router.get("/interventions", interventionController.listInterventions);
router.post("/interventions/:id/send", interventionController.sendIntervention);
```

## Controller Layer

Controllers translate HTTP requests into service calls.

Controllers may handle:

- Reading `req.params`, `req.query`, and `req.body`
- Calling schema validation
- Calling services
- Returning HTTP responses
- Passing errors to centralized error handling

Controllers should stay thin.

Example:

```ts
export async function listInterventions(req: Request, res: Response) {
  const query = listInterventionsSchema.parse(req.query);
  const result = await interventionService.listInterventions(query);

  res.status(200).json(result);
}
```

Do not put recommendation rules, risk scoring, or database query details in controllers.

## Service Layer

Services contain business logic.

Use services for:

- Risk scoring
- Intervention recommendation
- Adoption metric calculation
- ROI calculation
- Workflow matching
- Permission decisions
- State transitions

Example:

```ts
export async function sendIntervention(interventionId: string) {
  const intervention = await interventionRepository.findById(interventionId);

  if (!intervention) {
    throw new NotFoundError("Intervention not found");
  }

  if (intervention.status !== "draft") {
    throw new ConflictError("Only draft interventions can be sent");
  }

  return interventionRepository.updateStatus(interventionId, "sent");
}
```

Service functions should be named around product actions, not technical operations.

Good:

```txt
recommendToolSteeringInterventions
calculateDepartmentAdoptionMetrics
sendIntervention
classifyShadowAiRisk
```

Avoid:

```txt
processData
handleStuff
updateThing
doLogic
```

## Repository Layer

Repositories own data access.

Use repositories for:

- Database queries
- Mock data reads/writes
- Persistence-specific filtering
- Mapping database rows to domain objects

Repositories should not contain business policy.

Example:

```ts
export async function findUsageSignalsByDepartment(departmentId: string) {
  return db.usageSignal.findMany({
    where: { employee: { departmentId } },
  });
}
```

If using mock data in an interview, still keep it behind repository functions. This makes it easy to explain how the backend would move to a real database.

## Schemas and Validation

Validate all external input at the boundary.

Use schema files for:

- Request body validation
- Query validation
- Params validation
- Response shape validation when useful


Example:

```ts
export const createInterventionSchema = z.object({
  employeeId: z.string().min(1),
  currentToolId: z.string().min(1),
  recommendedToolId: z.string().min(1),
  reason: z.string().min(1),
});
```

Never trust request data just because the frontend sends it.

## Types

Keep domain types explicit and close to the module that owns them.

Example:

```ts
export type InterventionStatus = "draft" | "sent" | "accepted" | "dismissed";

export type Intervention = {
  id: string;
  employeeId: string;
  currentToolId: string;
  recommendedToolId: string;
  reason: string;
  status: InterventionStatus;
  createdAt: string;
  updatedAt: string;
};
```

Shared cross-module types can live in `src/global/types.ts`, but do not move types there unless they are truly shared.

## Global Utilities

Global backend utilities belong in:

```txt
src/global/global-utils.ts
```

Use global utilities for generic helpers:

- Date handling
- ID creation
- Pagination helpers
- Safe parsing
- Number and currency formatting
- Generic sorting
- Request metadata extraction

Module-specific utilities belong in:

```txt
src/modules/<module-name>/<module-name>.utils.ts
```

Do not duplicate utility logic across modules.

## Config

All environment access should go through:

```txt
src/global/config.ts
```

Do not read `process.env` throughout the codebase.

Good:

```ts
const port = config.server.port;
```

Avoid:

```ts
const port = process.env.PORT;
```

Validate required environment variables at startup. Fail fast when required config is missing.

## Errors

Use consistent application errors.

Create shared error classes in:

```txt
src/global/errors.ts
```

Recommended error types:

- `BadRequestError`
- `UnauthorizedError`
- `ForbiddenError`
- `NotFoundError`
- `ConflictError`
- `InternalServerError`

Centralize HTTP error formatting in:

```txt
src/middleware/error.middleware.ts
```

Do not handcraft different error response shapes in every controller.

Recommended response shape:

```json
{
  "error": {
    "code": "INTERVENTION_NOT_FOUND",
    "message": "Intervention not found"
  }
}
```

## Logging

Use a central logger:

```txt
src/global/logger.ts
```

Log important operational events:

- Request failures
- External service failures
- Security-sensitive events
- Background job failures
- Unexpected state transitions

Do not log sensitive user data, secrets, raw tokens, or private behavioral data.

For an Oximy-style product, treat AI usage behavior as sensitive.

## Security and Privacy

Backend code must be privacy-conscious by default.

For AI adoption data:

- Do not expose raw network logs unless explicitly required.
- Do not expose inferred professional intelligence directly to employees.
- Do not return sensitive fields by default.
- Keep admin and employee views separate.
- Validate authorization before returning department or employee-level data.
- Log aggregate metadata, not sensitive payloads.

Design APIs around least privilege.

## API Design

Use resource-oriented routes.

Examples:

```txt
GET    /api/tools
GET    /api/usage-signals
GET    /api/departments/:id/adoption-metrics
GET    /api/interventions
POST   /api/interventions
POST   /api/interventions/:id/send
PATCH  /api/interventions/:id/status
```

Prefer explicit product actions when state transitions matter:

```txt
POST /api/interventions/:id/send
```

This is clearer than a generic update when sending has business rules.

## Oximy-Style Domain Modules

For an AI adoption dashboard, likely modules are:

```txt
modules/
  employees/
  departments/
  tools/
  usage-signals/
  interventions/
  adoption-metrics/
  roi/
```

Keep the product loop visible in the backend:

```txt
Observe usage -> detect opportunity or risk -> recommend intervention -> measure outcome
```

Useful service functions:

```txt
detectShadowAiUsage
classifyToolRisk
recommendToolSteeringInterventions
calculateAdoptionVelocity
calculateSalaryCalibratedRoi
measureInterventionImpact
```

## Async Work

For interview builds, avoid unnecessary job systems unless the prompt requires them.

If background work is needed, isolate it:

```txt
src/jobs/
  sync-usage-signals.job.ts
  calculate-adoption-metrics.job.ts
```

Keep job logic in services. Job files should orchestrate when work runs, not contain the business logic itself.

## Testing

Prioritize tests for business logic.

Test:

- Risk scoring
- ROI calculations
- Adoption metrics
- Intervention state transitions
- Authorization boundaries
- Schema validation

Lower priority in a timed build:

- Full route tests
- Exhaustive repository tests
- Snapshot tests

Good test targets:

```txt
interventions.service.test.ts
adoption-metrics.service.test.ts
tools.utils.test.ts
```

## Comments

Follow `agent-docs/CLEAN.md`.

Do not add comments that narrate obvious backend code. Add comments only for important business, security, privacy, or architectural context.

## Implementation Checklist

Before coding:

- Identify the primary backend modules.
- Define domain types.
- Define request/response schemas.
- Decide whether data is mock, in-memory, file-backed, or database-backed.
- Keep mock persistence behind repositories.

During coding:

- Keep controllers thin.
- Put business rules in services.
- Put persistence in repositories.
- Validate inputs at the boundary.
- Use centralized config.
- Use centralized error handling.
- Avoid leaking sensitive data.

Before finishing:

- Check route names are clear.
- Check service names describe product actions.
- Remove duplicated utility logic.
- Remove unnecessary comments.
- Verify important business logic with focused tests when possible.