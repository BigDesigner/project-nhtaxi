/**
 * The agreement a user accepts when they sign up.
 *
 * Only the *version* lives here — the wording itself belongs with the UI that
 * displays it. What the server needs is a stable identifier it can record
 * against the account, so that in a dispute we can say which text the person
 * was shown, not merely that they ticked something.
 *
 * Bump this date whenever the wording changes materially. Existing accounts
 * keep the version they accepted; re-acceptance is a product decision, not an
 * automatic consequence of the constant changing.
 */
export const CURRENT_TERMS_VERSION = "2026-07-20";
