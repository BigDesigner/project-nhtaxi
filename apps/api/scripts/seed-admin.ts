// One-time (or occasional) admin bootstrap. There is no self-service admin
// sign-up by design (L15/L16) — this generates the SQL to create the first
// one, using the exact same password hashing as the API (lib/password.ts),
// so the resulting account can log in normally via POST /api/auth/login.
//
// This script never touches the database itself — it only computes the
// hash and writes a .sql file for you to review and run yourself:
//   pnpm run seed:admin -- admin@nhtaxi.com "some strong password" Ada Admin
//   npx wrangler d1 execute gnncab --remote --file=./scripts/seed-admin.sql
import { writeFileSync } from "node:fs";
import { hashPassword } from "../src/lib/password";

const [, , email, password, firstName = "Admin", lastName = "User"] = process.argv;

if (!email || !password) {
  console.error('Usage: pnpm run seed:admin -- <email> "<password>" [firstName] [lastName]');
  process.exit(1);
}
if (password.length < 8) {
  console.error("Password must be at least 8 characters (matches the API's own rule).");
  process.exit(1);
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

const passwordHash = await hashPassword(password);
const id = crypto.randomUUID();
const nowSeconds = Math.floor(Date.now() / 1000);

const sql = `INSERT INTO users (id, email, password_hash, first_name, last_name, role, is_active, created_at, updated_at)
VALUES (${sqlString(id)}, ${sqlString(email)}, ${sqlString(passwordHash)}, ${sqlString(firstName)}, ${sqlString(lastName)}, 'admin', 1, ${nowSeconds}, ${nowSeconds});
`;

const outPath = new URL("./seed-admin.sql", import.meta.url);
writeFileSync(outPath, sql, "utf8");

console.log(`Wrote ${outPath.pathname.slice(1)}`);
console.log("\nReview it, then run yourself:");
console.log("  npx wrangler d1 execute gnncab --local --file=./scripts/seed-admin.sql   # local dev");
console.log("  npx wrangler d1 execute gnncab --remote --file=./scripts/seed-admin.sql  # production");
