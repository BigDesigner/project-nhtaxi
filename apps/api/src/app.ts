import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import type { AppBindings } from "./env";
import { requireCsrfForCookieAuth } from "./middlewares/csrf";
import adminRoutes from "./routes/admin";
import authRoutes from "./routes/auth";
import customerProfileRoutes from "./routes/customer_profile";
import driverProfileRoutes from "./routes/driver_profile";
import driversDirectoryRoutes from "./routes/drivers_directory";
import { RoutingUnavailableError } from "./lib/routing";
import health from "./routes/health";
import pushTokenRoutes from "./routes/push_tokens";
import referralTripRoutes from "./routes/referral_trips";
import tripRoutes from "./routes/trips";

const app = new OpenAPIHono<AppBindings>();

// Cross-subdomain admin (admin.nhtaxi.com → api.nhtaxi.com, L28). Mobile uses
// Bearer tokens and is unaffected by CORS.
app.use(
  "*",
  cors({
    origin: (origin, c) => {
      // Flutter Web is browser-hosted, so its XHRs are CORS-checked even
      // though the app authenticates with Bearer tokens rather than cookies
      // (see apps/mobile — it registers as ios/android on every platform).
      // Port 5174 is pinned in apps/mobile's run script so this origin stays
      // stable instead of Flutter picking a random dev port.
      const allowed =
        c.env.ENVIRONMENT === "development"
          ? ["http://localhost:5173", "http://localhost:5174"]
          : ["https://admin.nhtaxi.com", "https://gnncab.nhtaxi.com"];
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
// Mounted outside /api/driver on purpose: that path is owned by
// driver_profile's router, whose `use("*")` middleware would run first and
// make the ordering of two mounted routers load-bearing.
app.route("/api/referral-trips", referralTripRoutes);
app.route("/api/push-tokens", pushTokenRoutes);
app.route("/api/drivers", driversDirectoryRoutes);

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
  // Routing being unavailable means we cannot work out what a journey will
  // actually cost. Handled centrally so every pricing path reports it the
  // same way, including any added later. It is deliberately an error rather
  // than a fallback estimate: the final fare comes from this distance, so a
  // guessed number is charged to the business on every mile of every trip.
  if (err instanceof RoutingUnavailableError) {
    console.error("[Routing]", err.message);
    return c.json(
      {
        error: "RoutingUnavailable",
        message: "We can't work out the distance for this trip right now. Please try again, or call dispatch.",
      },
      503
    );
  }

  console.error("[Error]", err);
  return c.json({ error: "InternalServerError", message: "An unexpected error occurred" }, 500);
});

app.notFound((c) => c.json({ error: "NotFound", message: "Route not found" }, 404));

export default app;
