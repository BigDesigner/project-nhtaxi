import 'dart:async';

import 'package:dio/dio.dart';
import 'package:latlong2/latlong.dart';

/// A place returned by address search.
class GeoPlace {
  const GeoPlace({required this.displayName, required this.point});

  final String displayName;
  final LatLng point;

  /// Nominatim returns a long comma-joined address; the first two segments
  /// are usually the only part a passenger needs to recognise the place.
  String get shortName {
    final parts = displayName.split(',');
    return parts.take(2).map((p) => p.trim()).join(', ');
  }
}

/// Free address search + reverse geocoding via OpenStreetMap Nominatim (L12 —
/// no Google Maps bill).
///
/// Nominatim's usage policy caps this at ~1 request/second and asks for an
/// identifying User-Agent. Callers must debounce (see [searchDebounce]) —
/// firing per keystroke would breach the policy and risk the public instance
/// blocking us. Note the User-Agent header only actually takes effect on
/// native builds; browsers forbid setting it, so Flutter Web sends the
/// browser's own. Acceptable at this volume, but it's the reason a
/// self-hosted or paid geocoder is the upgrade path if usage ever grows.
class GeocodingService {
  GeocodingService({Dio? dio}) : _dio = dio ?? Dio() {
    _dio.options
      ..connectTimeout = const Duration(seconds: 10)
      ..receiveTimeout = const Duration(seconds: 10)
      ..headers['User-Agent'] = 'NHTaxi/1.0 (https://nhtaxi.com)';
  }

  final Dio _dio;

  static const searchDebounce = Duration(milliseconds: 600);
  static const _base = 'https://nominatim.openstreetmap.org';

  /// Biased toward the service area (North Conway, NH — L21) so local
  /// results rank first without hard-excluding anything else.
  static const _viewBox = '-71.6,43.7,-70.6,44.4';

  Future<List<GeoPlace>> search(String query) async {
    if (query.trim().length < 3) return const [];

    final response = await _dio.get<dynamic>(
      '$_base/search',
      queryParameters: {
        'q': query,
        'format': 'jsonv2',
        'limit': 6,
        'countrycodes': 'us',
        'viewbox': _viewBox,
        'bounded': 0,
      },
    );

    final data = response.data;
    if (data is! List) return const [];
    return data
        .map((e) => e as Map<String, dynamic>)
        .map(
          (e) => GeoPlace(
            displayName: e['display_name'] as String? ?? '',
            point: LatLng(double.parse(e['lat'] as String), double.parse(e['lon'] as String)),
          ),
        )
        .toList();
  }

  /// Turns a map tap into a human-readable address.
  Future<String?> reverse(LatLng point) async {
    final response = await _dio.get<dynamic>(
      '$_base/reverse',
      queryParameters: {'lat': point.latitude, 'lon': point.longitude, 'format': 'jsonv2'},
    );
    final data = response.data;
    if (data is Map<String, dynamic>) return data['display_name'] as String?;
    return null;
  }
}
