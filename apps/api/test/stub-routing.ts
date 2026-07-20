import { vi } from "vitest";

/**
 * Stops tests from calling any real third-party service — routing and
 * transactional email, so far.
 *
 * Fares come from a live routing lookup (lib/routing.ts). Letting the suite
 * hit the public OSRM instance would make every trip test slow, dependent on
 * someone else's uptime, and a small denial-of-service against a free
 * community server. It would also make fare assertions non-deterministic,
 * since a road distance changes whenever OpenStreetMap data does. Email
 * (lib/email.ts) is stubbed for the same reason, plus the obvious one: a test
 * run must never actually send mail.
 *
 * Any *other* outbound request throws: an unexpected network call from a test
 * should be loud, not quietly allowed out.
 */

/** Every stubbed route is priced at this driving distance. */
export const STUB_ROUTE_MILES = 10;

const METRES_PER_MILE = 1609.344;

/** Set by a test that needs routing to fail rather than answer. */
let routingFails = false;

/** Makes the next routing calls fail, for paths that must refuse to quote. */
export function failRouting(value = true): void {
  routingFails = value;
}

export interface CapturedEmail {
  sender: { name: string; email: string };
  to: { email: string; name?: string }[];
  subject: string;
  htmlContent: string;
}

const brevoSentEmails: CapturedEmail[] = [];

/** Every email the suite has sent since the last reset, in send order. */
export function capturedEmails(): CapturedEmail[] {
  return brevoSentEmails;
}

/** Each test file shares this module, so tests that check email must clear it first. */
export function resetCapturedEmails(): void {
  brevoSentEmails.length = 0;
}

export function stubRouting(): void {
  const realFetch = globalThis.fetch;

  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

    if (url.includes("/route/v1/driving/")) {
      if (routingFails) return new Response("service unavailable", { status: 503 });
      return Response.json({
        code: "Ok",
        routes: [{ distance: STUB_ROUTE_MILES * METRES_PER_MILE }],
      });
    }

    if (url === "https://api.brevo.com/v3/smtp/email") {
      const body = JSON.parse(String(init?.body ?? "{}")) as CapturedEmail;
      brevoSentEmails.push(body);
      return Response.json({ messageId: "stub-message-id" }, { status: 201 });
    }

    // Requests to the test worker itself (how the HTTP helpers drive the app)
    // must still go through.
    if (url.startsWith("http://localhost") || url.startsWith("https://localhost")) {
      return realFetch(input, init);
    }

    throw new Error(
      `Unexpected outbound request in a test: ${url}\n` +
        "Add a stub for it rather than letting the suite reach the network."
    );
  });
}
