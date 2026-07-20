/// How a quoted fare is presented to passengers.
///
/// The quote is a **floor, not a midpoint**. It's priced off a drivable
/// route estimate (see ROAD_DISTANCE_FACTOR in apps/api/src/lib/fare.ts), so
/// a passenger pays that figure on any ordinary trip and only ever pays more
/// — never less. Showing it as a symmetric band was wrong twice over: it
/// dangled a lower price that can't happen, and on a $300 airport run a
/// "$250 – $350" spread is wide enough to put someone off booking at all.
///
/// So the quote leads with the actual expected price and carries a ceiling
/// behind it. A completed trip has a real charged amount in `finalFare` and
/// is shown exactly, with no ceiling at all.
library;

/// Headroom above the quote for things the straight-line estimate can't see:
/// a closure on Route 16, roadworks, or a driver taking a longer way round
/// because the direct road is backed up.
///
/// 10% rather than 5% because rural New Hampshire detours are not small — the
/// alternatives to a closed mountain road can be many extra miles. A ceiling
/// that gets exceeded is worse than one that's slightly generous, since the
/// whole point is that the passenger is never surprised upward at the kerb.
const fareCeilingMargin = 0.10;

/// The price a passenger should expect to pay, to the cent.
String formatFare(double fare, {String currency = 'USD'}) =>
    '${_symbolFor(currency)}${fare.toStringAsFixed(2)}';

/// The most this trip should cost if the route doesn't go to plan.
///
/// Rounded up to a whole dollar: cent precision on a ceiling implies a
/// exactness it doesn't have.
String formatFareCeiling(double fare, {String currency = 'USD'}) =>
    '${_symbolFor(currency)}${(fare * (1 + fareCeilingMargin)).ceil()}';

/// One-line explanation to sit under a quote.
String fareCeilingNote(double fare, {String currency = 'USD'}) =>
    'up to ${formatFareCeiling(fare, currency: currency)} if traffic or a closure forces a detour';

String _symbolFor(String currency) => currency == 'USD' ? r'$' : '$currency ';
