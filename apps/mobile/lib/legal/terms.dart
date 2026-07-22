/// The agreements shown at sign-up.
///
/// Adapted from the notice on nhtaxi.com for the app, and split in two:
/// passengers and drivers are agreeing to genuinely different things. A
/// driver's document handling, eligibility under RSA 376-A and what they owe
/// GNN LLC have no bearing on a passenger, and burying them in one document
/// would mean neither party reads the part that applies to them.
///
/// **These describe what the software actually does.** The privacy sections
/// deliberately do not claim "we never share your data with anyone" — that
/// would be untrue: addresses go to OpenStreetMap to be looked up, and device
/// tokens go to Firebase to deliver notifications. Overclaiming here would be
/// worse than saying nothing, so it says precisely what happens instead.
///
/// [termsVersion] must match CURRENT_TERMS_VERSION in packages/contract; the
/// server records it against the account so a dispute can establish which
/// wording was shown. Change the wording, change both.
library;

const termsVersion = '2026-07-22';

class TermsSection {
  const TermsSection(this.heading, this.body);

  final String heading;
  final String body;
}

class TermsDocument {
  const TermsDocument({
    required this.title,
    required this.intro,
    required this.sections,
    required this.acceptLabel,
  });

  final String title;
  final String intro;
  final List<TermsSection> sections;
  final String acceptLabel;
}

const passengerTerms = TermsDocument(
  title: 'Passenger Terms',
  intro:
      'NH Taxi is operated by GNN LLC, a licensed Transportation Network Company '
      'authorised to operate in the State of New Hampshire under RSA 376-A. '
      'Please read these terms before creating an account. You cannot use the '
      'app without accepting them.',
  acceptLabel: 'I have read and accept the Passenger Terms',
  sections: [
    TermsSection(
      '1. What this app does',
      'NH Taxi connects you with independent drivers. GNN LLC provides the '
          'technology; the driver provides the transport. We are not a carrier '
          'and we do not employ the drivers.',
    ),
    TermsSection(
      '2. No guarantee of availability',
      'Requesting a trip does not guarantee that a driver will accept it. '
          'Availability depends on who is on shift, where they are, the weather '
          'and road conditions. If no driver is found we will tell you, and you '
          'can try again or call us.',
    ),
    TermsSection(
      '3. Fares and payment',
      'You pay the driver directly, in cash. GNN LLC does not process, hold or '
          'handle ride payments, and the app never asks for card details.\n\n'
          'The price shown before you book is calculated from the driving '
          'distance along real roads. It is an estimate: if traffic, roadworks '
          'or a closure forces a different route, the final fare can be higher. '
          'The app shows an upper figure so you know the most it should come to '
          'before you commit.',
    ),
    TermsSection(
      '4. Cancelling',
      'You can cancel free of charge at any point up until your driver sets off '
          'towards you. Once they are on the way, please call dispatch instead — '
          'someone is already driving to meet you. Cancellations are recorded.',
    ),
    TermsSection(
      '5. Your information and how it is protected',
      'We collect only what running the service requires: your name, email, '
          'phone number, and the pickup and destination of your trips. Your '
          'password is never stored — only an irreversible cryptographic hash of '
          'it. Traffic between the app and our servers is encrypted in transit.\n\n'
          'We do not sell your information, and we do not share it for '
          'advertising or marketing. It is shared only where the service cannot '
          'work otherwise:\n\n'
          '• the driver assigned to your trip sees your name, phone number and '
          'the pickup and destination, so they can collect you;\n'
          '• addresses you search are sent to OpenStreetMap to be looked up;\n'
          '• if you enable notifications, a device identifier is held by Google '
          'Firebase to deliver them.\n\n'
          'Nothing else leaves GNN LLC.',
    ),
    TermsSection(
      '6. Your responsibilities',
      'Give accurate information, particularly your phone number and pickup '
          'location — a driver cannot find you otherwise. Do not attempt to '
          'access parts of the system that are not yours, such as driver or '
          'administrative areas. Treat drivers with respect.',
    ),
    TermsSection(
      '7. Governing law',
      'These terms are governed by the laws of the State of New Hampshire, '
          'without regard to its conflict of laws principles. Any dispute will be '
          'heard in the state or federal courts located in New Hampshire.',
    ),
  ],
);

const driverTerms = TermsDocument(
  title: 'Driver Agreement',
  intro:
      'NH Taxi is operated by GNN LLC, a licensed Transportation Network Company '
      'authorised to operate in the State of New Hampshire under RSA 376-A. '
      'This agreement covers your eligibility, what you pay GNN LLC, and how '
      'your documents and information are handled. You cannot drive without '
      'accepting it.',
  acceptLabel: 'I have read and accept the Driver Agreement',
  sections: [
    TermsSection(
      '1. Independent contractor',
      'You are an independent contractor, not an employee of GNN LLC. You '
          'decide when to go online and which jobs to accept. GNN LLC provides '
          'the technology that connects you with passengers.',
    ),
    TermsSection(
      '2. Eligibility (RSA 376-A)',
      'You may only drive if you meet the criteria set out in RSA 376-A. That '
          'includes passing a background check, holding a valid New Hampshire '
          "driver's licence, and keeping current vehicle insurance and "
          'registration. You must tell us promptly if any of these lapse.\n\n'
          'Your account stays inactive until the office has verified you. Until '
          'then you cannot go online and will not be sent work.',
    ),
    TermsSection(
      '3. Your documents are encrypted',
      'The identity documents you upload — licence, background check and '
          'similar — are encrypted before they are stored. Each file is '
          'encrypted with its own key, and that key is itself encrypted with a '
          'master key held separately as a server secret. Nobody browsing the '
          'storage can read them.\n\n'
          'These documents are visible only to GNN LLC administrators, for '
          'verification. They are never shown to passengers, never shared with '
          'other drivers, and never sold or passed to third parties.',
    ),
    TermsSection(
      '4. What passengers can see',
      'So a passenger can find you and know who is collecting them, the app '
          'shows them your first name, your profile photo, your vehicle and '
          'plate, your phone number, and your position on the map while you are '
          'online. Your surname, address, email, licence number and documents '
          'are never shown.\n\n'
          'Your position is only shared while you are online. Going offline '
          'stops it immediately.',
    ),
    TermsSection(
      '5. Fares you collect',
      'Passengers pay you directly, in cash. GNN LLC does not process, hold or '
          'handle ride payments — the money is yours from the moment it is '
          'handed over.',
    ),
    TermsSection(
      '6. What you pay GNN LLC',
      'Two charges, both shown in the app at all times:\n\n'
          '• Time online — a per-minute charge for every minute your app is '
          'online, whether or not a job comes in. Going offline stops it. If the '
          'app stops responding we close the session automatically and charge '
          'only up to that point.\n\n'
          '• Commission on assigned jobs — when the office hands you a job '
          'directly, you owe a percentage of that fare. The exact figure is '
          'shown before you accept, and you are free to turn the job down.\n\n'
          'Ordinary jobs you receive through normal dispatch carry no '
          'commission. You settle the balance in cash with the office, and the '
          'app shows the running total and the sessions behind it.',
    ),
    TermsSection(
      '7. Your information and how it is protected',
      'Your password is never stored — only an irreversible cryptographic hash '
          'of it. Traffic between the app and our servers is encrypted in '
          'transit, and every administrative action on your account is recorded '
          'in an audit log.\n\n'
          'We do not sell your information and we do not share it for '
          'advertising or marketing. It goes outside GNN LLC only where the '
          'service cannot work otherwise: addresses are looked up via '
          'OpenStreetMap, and if you enable notifications a device identifier is '
          'held by Google Firebase to deliver them.',
    ),
    TermsSection(
      '8. Conduct and accurate information',
      'Keep your vehicle details and plate accurate — passengers rely on them '
          'to identify your car. Do not accept a job you cannot complete, and do '
          'not attempt to access parts of the system that are not yours. Serious '
          'or repeated problems may result in your account being suspended.',
    ),
    TermsSection(
      '9. Governing law',
      'This agreement is governed by the laws of the State of New Hampshire, '
          'without regard to its conflict of laws principles. Any dispute will be '
          'heard in the state or federal courts located in New Hampshire.',
    ),
  ],
);
