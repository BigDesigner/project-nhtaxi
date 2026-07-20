import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Which shell a dual-role account (a driver who also has admin access —
/// see `AppUser.canSwitchRoleView`) is currently looking at.
///
/// This is a pure UI choice, not an authorization boundary: both API
/// surfaces are reachable to that account at all times regardless of this
/// value. Defaults to 'driver' — arriving at the app shows the driver
/// screens first, and the admin panel is one tap away in settings, per the
/// office's own request.
class ViewMode extends Notifier<String> {
  @override
  String build() => 'driver';

  // ignore: use_setters_to_change_properties
  void set(String value) => state = value;
}

final viewModeProvider = NotifierProvider<ViewMode, String>(ViewMode.new);
