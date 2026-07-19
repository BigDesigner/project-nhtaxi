import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import type { AppBindings } from "./env";
import { requireCsrfForCookieAuth } from "./middlewares/csrf";
import adminRoutes from "./routes/admin";
import authRoutes from "./routes/auth";
import customerProfileRoutes from "./routes/customer_profile";
import driverProfileRoutes from "./routes/driver_profile";
import health from "./routes/health";
import tripRoutes from "./routes/trips";

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
app.route("/api/driver", driverProfileRoutes);
app.route("/api/customer", customerProfileRoutes);
app.route("/api/admin", adminRoutes);
app.route("/api/trips", tripRoutes);

// Faz 4: live tracking — single global LocationHub DO, every driver/
// customer/admin WebSocket connects here (auth happens inside the DO
// since Upgrade requests can't carry the CSRF/cookie middleware chain).
app.get("/api/ws", (c) => {
  const id = c.env.LOCATION_HUB.idFromName("global");
  const stub = c.env.LOCATION_HUB.get(id);
  return stub.fetch(c.req.raw);
});

// Code-first contract (L: contract strategy) — the OpenAPI doc below is
// generated from the zod schemas in packages/contract + the routes
// registered above, and is what the web (TS) and Flutter (Dart) clients get
// generated from in later phases. Never hand-edit an openapi.yaml.
app.doc("/api/openapi.json", {
  openapi: "3.1.0",
  info: { title: "GNNcab API", version: "0.0.0" },
  servers: [{ url: "/api" }],
});

app.onError((err, c) => {
  console.error("[Error]", err);
  return c.json({ error: "InternalServerError", message: "An unexpected error occurred" }, 500);
});

app.notFound((c) => c.json({ error: "NotFound", message: "Route not found" }, 404));

export default app;
