import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import type { AppBindings } from "./env";
import { requireCsrfForCookieAuth } from "./middlewares/csrf";
import authRoutes from "./routes/auth";
import health from "./routes/health";

const app = new OpenAPIHono<AppBindings>();

// Cross-subdomain admin (admin.nhtaxi.com → api.nhtaxi.com, L28). Mobile uses
// Bearer tokens and is unaffected by CORS.
app.use(
  "*",
  cors({
    origin: (origin, c) => {
      const allowed =
        c.env.ENVIRONMENT === "development" ? ["http://localhost:5173"] : ["https://admin.nhtaxi.com"];
      return origin && allowed.includes(origin) ? origin : null;
    },
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-CSRF-Token"],
  })
);

app.use("*", requireCsrfForCookieAuth);

app.route("/api", health);
app.route("/api/auth", authRoutes);

// Code-first contract (L: contract strategy) — the OpenAPI doc below is
// generated from the zod schemas in packages/contract + the routes
// registered above, and is what the web (TS) and Flutter (Dart) clients get
// generated from in later phases. Never hand-edit an openapi.yaml.
app.doc("/api/openapi.json", {
  openapi: "3.1.0",
  info: { title: "GNNcab API", version: "0.0.0" },
  servers: [{ url: "/api" }],
});

// Faz 2 adds: the rest of the route tree (trips, drivers, admin, ...).

app.onError((err, c) => {
  console.error("[Error]", err);
  return c.json({ error: "InternalServerError", message: "An unexpected error occurred" }, 500);
});

app.notFound((c) => c.json({ error: "NotFound", message: "Route not found" }, 404));

export default app;
