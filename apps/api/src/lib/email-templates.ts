/**
 * Email content. Deliberately plain — layout and branding are an explicit
 * "detail it later" item; what matters for this pass is that the right
 * information reaches the right inbox at the right moment.
 */

function wrap(bodyHtml: string): string {
  return `<!doctype html><html><body style="font-family: -apple-system, Arial, sans-serif; color: #1a1a1a;">
${bodyHtml}
<p style="color:#888; font-size:12px; margin-top:24px;">GNN LLC &middot; North Conway, NH</p>
</body></html>`;
}

function money(cents: number, currency: string): string {
  return `${(cents / 100).toFixed(2)} ${currency}`;
}

export interface EmailContent {
  subject: string;
  html: string;
}

export function welcomeEmail(firstName: string, role: "customer" | "driver"): EmailContent {
  if (role === "driver") {
    return {
      subject: "Welcome to NH Taxi — you're signed up",
      html: wrap(
        `<p>Hi ${firstName},</p>` +
          `<p>Thanks for signing up to drive with NH Taxi. The office will review your ` +
          `documents and approve your account before you can go online — you'll hear from ` +
          `us once that's done.</p>`
      ),
    };
  }
  return {
    subject: "Welcome to NH Taxi",
    html: wrap(`<p>Hi ${firstName},</p><p>Thanks for creating a NH Taxi account. You're ready to book a ride whenever you need one.</p>`),
  };
}

export function adminNewSignupEmail(fullName: string, email: string, role: "customer" | "driver"): EmailContent {
  if (role === "driver") {
    return {
      subject: `New driver sign-up: ${fullName}`,
      html: wrap(
        `<p>${fullName} (${email}) just signed up to drive. Review their documents and ` +
          `approve them in the admin panel before they can go online.</p>`
      ),
    };
  }
  return {
    subject: `New passenger sign-up: ${fullName}`,
    html: wrap(`<p>${fullName} (${email}) just created a passenger account.</p>`),
  };
}

export function passwordChangedEmail(firstName: string): EmailContent {
  return {
    subject: "Your NH Taxi password was changed",
    html: wrap(`<p>Hi ${firstName},</p><p>Your password was just changed. If this wasn't you, contact GNN LLC immediately.</p>`),
  };
}

export interface TripSummaryForEmail {
  id: string;
  pickupAddress: string;
  dropoffAddress: string | null;
  distanceMiles: number | null;
  finalFareCents: number | null;
  currency: string;
  driverName: string | null;
  customerName: string | null;
}

export function tripCompletedEmail(trip: TripSummaryForEmail, audience: "customer" | "admin"): EmailContent {
  const fare = trip.finalFareCents != null ? money(trip.finalFareCents, trip.currency) : "not recorded";
  const distance = trip.distanceMiles != null ? `${trip.distanceMiles.toFixed(1)} mi` : "not recorded";

  const rows = [
    `<tr><td style="padding-right:16px;color:#666;">Pickup</td><td>${trip.pickupAddress}</td></tr>`,
    `<tr><td style="padding-right:16px;color:#666;">Dropoff</td><td>${trip.dropoffAddress ?? "not recorded"}</td></tr>`,
    `<tr><td style="padding-right:16px;color:#666;">Distance</td><td>${distance}</td></tr>`,
    `<tr><td style="padding-right:16px;color:#666;">Fare</td><td>${fare}</td></tr>`,
    audience === "admin"
      ? `<tr><td style="padding-right:16px;color:#666;">Driver</td><td>${trip.driverName ?? "unknown"}</td></tr>`
      : "",
    audience === "admin"
      ? `<tr><td style="padding-right:16px;color:#666;">Passenger</td><td>${trip.customerName ?? "guest"}</td></tr>`
      : "",
  ]
    .filter(Boolean)
    .join("");

  const intro =
    audience === "admin" ? "<p>A trip just completed.</p>" : "<p>Thanks for riding with NH Taxi. Here's your trip summary.</p>";

  return {
    subject: audience === "admin" ? `Trip completed — ${trip.id.slice(0, 8)}` : "Your trip is complete",
    html: wrap(`${intro}<table cellpadding="4" style="border-collapse:collapse;">${rows}</table>`),
  };
}
