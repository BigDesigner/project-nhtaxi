/// The short, human-friendly form of a trip id: its first 8 characters.
///
/// Every trip id is a UUID; the first 8 hex chars are enough to read out over
/// the phone ("what's your trip ID?") and to eyeball in a report. It is not
/// guaranteed unique on its own — the admin lookup matches by prefix and shows
/// every hit — but a collision across a small fleet is astronomically unlikely.
String shortTripId(String id) => id.length >= 8 ? id.substring(0, 8) : id;
