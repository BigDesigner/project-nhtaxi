import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { HealthResponseSchema } from "@gnncab/contract";
import type { AppBindings } from "../env";

const health = new OpenAPIHono<AppBindings>();

const healthRoute = createRoute({
  method: "get",
  path: "/healthz",
  tags: ["health"],
  summary: "Health check",
  responses: {
    200: {
      description: "Service is healthy",
      content: { "application/json": { schema: HealthResponseSchema } },
    },
  },
});

health.openapi(healthRoute, (c) => {
  return c.json({ status: "ok" as const, environment: c.env.ENVIRONMENT });
});

export default health;
