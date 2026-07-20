/// How a quoted fare is presented to passengers.
///
/// The estimate comes from straight-line distance against a rate card, so it
/// can only ever be approximate: the driver may take a different route,
/// traffic or a closure may force a detour, and the meter reflects what
/// actually happened. Quoting a single exact figure ("$145") reads as a
/// promise and turns every normal variation into an argument at the kerb.
///
/// So a booking quote is always shown as a band, and the passenger sees it
/// before the trip starts. Once a trip is finished, `finalFare` is a real
/// charged amount and is shown exactly — never as a range.
library;

/// ±10% either side of the estimate. Wide enough to absorb an ordinary
/// re-route, narrow enough to still be useful when deciding whether to book.
const fareRangeTolerance = 0.10;

/// Rounds to whole dollars: cent-precision on a number this uncertain is
/// false precision, and "$135 – $160" is easier to read than "$134.55 –
/// $164.45".
String formatFareRange(double fare, {String currency = 'USD'}) {
  final symbol = _symbolFor(currency);
  final low = (fare * (1 - fareRangeTolerance)).floor();
  final high = (fare * (1 + fareRangeTolerance)).ceil();
  // Very short hops can collapse to the same dollar figure at both ends;
  // showing "$8 – $8" would look broken, so fall back to a single number.
  if (low >= high) return '$symbol$high';
  return '$symbol$low – $symbol$high';
}

/// An exact, already-charged amount.
String formatFare(double fare, {String currency = 'USD'}) =>
    '${_symbolFor(currency)}${fare.toStringAsFixed(2)}';

String _symbolFor(String currency) => currency == 'USD' ? r'$' : '$currency ';
