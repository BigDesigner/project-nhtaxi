import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import { CustomerProfileResponseSchema, ErrorResponseSchema } from "@gnncab/contract";
import { createDb, customerProfilesTable, usersTable } from "@gnncab/db";
import type { AppBindings } from "../env";
import { authenticate, requireRole } from "../middlewares/auth";

const customerProfile = new OpenAPIHono<AppBindings>();

customerProfile.use("/profile", authenticate, requireRole("customer"));

const getProfileRoute = createRoute({
  method: "get",
  path: "/profile",
  tags: ["customer"],
  summary: "Get my own customer profile",
  responses: {
    200: { description: "Profile", content: { "application/json": { schema: CustomerProfileResponseSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

customerProfile.openapi(getProfileRoute, async (c) => {
  const authUser = c.get("user")!;
  const db = createDb(c.env.DB);

  const [profile] = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      phone: usersTable.phone,
      preferredPaymentMethod: customerProfilesTable.preferredPaymentMethod,
      totalTrips: customerProfilesTable.totalTrips,
    })
    .from(customerProfilesTable)
    .innerJoin(usersTable, eq(customerProfilesTable.userId, usersTable.id))
    .where(eq(customerProfilesTable.userId, authUser.userId))
    .limit(1);

  if (!profile) {
    return c.json({ error: "NotFound", message: "Customer profile not found" }, 404);
  }
  return c.json(profile, 200);
});

export default customerProfile;
