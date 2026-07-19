import type { PushNotification } from "./fcm";

// Faz 6, plan §4.7 — customer gets notified at these five trip-status
// transitions; anything not listed here (DRIVER_ACCEPTED/REJECTED, etc.)
// intentionally has no customer-facing push.
const CUSTOMER_STATUS_NOTIFICATIONS: Partial<Record<string, PushNotification>> = {
  DRIVER_ASSIGNED: { title: "Driver assigned", body: "A driver has been assigned to your trip." },
  DRIVER_EN_ROUTE: { title: "Driver on the way", body: "Your driver is on the way to your pickup location." },
  DRIVER_ARRIVED: { title: "Driver has arrived", body: "Your driver has arrived at the pickup location." },
  TRIP_STARTED: { title: "Trip started", body: "Your trip has started." },
  TRIP_COMPLETED: { title: "Trip completed", body: "Your trip is complete. Thanks for riding with us!" },
};

export function customerTripNotification(status: string): PushNotification | null {
  return CUSTOMER_STATUS_NOTIFICATIONS[status] ?? null;
}

// Not in the plan's original list, but confirmed with the user as a
// practical necessity: a driver needs to know a job just landed on them
// (whether via auto-dispatch or an admin's direct assignment) within the
// 60-second accept window, not just by happening to have the app open.
export const NEW_TRIP_ASSIGNED_NOTIFICATION: PushNotification = {
  title: "New trip request",
  body: "You have a new trip request — open the app to respond.",
};
