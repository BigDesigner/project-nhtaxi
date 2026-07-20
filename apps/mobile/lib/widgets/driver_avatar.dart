import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/api_client.dart';
import '../core/providers.dart';

/// A driver's photo, fetched through the authenticated API.
///
/// `NetworkImage` is no use here: the photo route requires a Bearer token and
/// on the web build the browser owns request headers, so the token can never
/// be attached. Fetching bytes through the API client keeps the interceptor —
/// and therefore the token and the 401 refresh — and works identically on
/// every platform.
///
/// Falls back to the driver's initial whenever there's no photo or the fetch
/// fails, so a missing image never leaves a hole in the layout.
final driverPhotoProvider = FutureProvider.family<Uint8List?, String>((ref, path) async {
  try {
    return await ref.read(apiClientProvider).getBytes(path);
  } on ApiException {
    // A driver without a photo is the normal case, not an error worth
    // surfacing — the initial below is a perfectly good stand-in.
    return null;
  }
});

class DriverAvatar extends ConsumerWidget {
  const DriverAvatar({
    super.key,
    required this.name,
    required this.photoUrl,
    this.radius = 20,
    this.color,
  });

  final String name;

  /// The API path from the drivers directory, e.g. `/api/drivers/{id}/photo`.
  final String? photoUrl;

  final double radius;
  final Color? color;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tint = color ?? Theme.of(context).colorScheme.primary;
    final initial = name.isNotEmpty ? name[0].toUpperCase() : '?';

    final fallback = CircleAvatar(
      radius: radius,
      backgroundColor: tint.withValues(alpha: 0.15),
      child: Text(initial, style: TextStyle(fontSize: radius * 0.8, color: tint)),
    );

    if (photoUrl == null) return fallback;

    final photo = ref.watch(driverPhotoProvider(photoUrl!));
    return switch (photo) {
      AsyncData(:final value?) => CircleAvatar(radius: radius, backgroundImage: MemoryImage(value)),
      _ => fallback,
    };
  }
}
