/// One identity document a driver has uploaded.
///
/// Mirrors DriverDocumentSchema. Deliberately carries no file bytes: the
/// upload route stores these envelope-encrypted and only an admin can ever
/// read them back, so a driver's own view is status-only.
class DriverDocument {
  const DriverDocument({
    required this.id,
    required this.type,
    required this.status,
    required this.uploadedAt,
    this.reviewedAt,
  });

  final String id;

  /// license / background_check / photo
  final String type;

  /// PENDING / APPROVED / REJECTED
  final String status;

  final DateTime uploadedAt;
  final DateTime? reviewedAt;

  bool get isApproved => status == 'APPROVED';
  bool get isRejected => status == 'REJECTED';
  bool get isPending => status == 'PENDING';

  String get typeLabel => switch (type) {
        'license' => "Driver's licence",
        'background_check' => 'Background check',
        'photo' => 'Photo ID',
        _ => type,
      };

  String get statusLabel => switch (status) {
        'PENDING' => 'Waiting for review',
        'APPROVED' => 'Approved',
        'REJECTED' => 'Rejected — please upload a new one',
        _ => status,
      };

  factory DriverDocument.fromJson(Map<String, dynamic> json) => DriverDocument(
        id: json['id'] as String,
        type: json['type'] as String,
        status: json['status'] as String,
        uploadedAt: DateTime.parse(json['uploadedAt'] as String),
        reviewedAt: json['reviewedAt'] == null ? null : DateTime.parse(json['reviewedAt'] as String),
      );
}

/// What the office must see before a driver can be approved.
///
/// `photo` is not here: a profile picture is a nicety, not evidence of
/// eligibility. Under RSA 376-A the licence and the background check are the
/// two that actually gate someone driving passengers.
const requiredDocumentTypes = ['license', 'background_check'];
