import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/driver_location_broadcaster.dart';
import 'driver_controllers.dart';
import 'driver_earnings_tab.dart';
import 'driver_home_tab.dart';
import 'driver_profile_tab.dart';

/// Jobs / Earnings / Profile — the driver's equivalent of the passenger shell.
class DriverShell extends ConsumerStatefulWidget {
  const DriverShell({super.key});

  @override
  ConsumerState<DriverShell> createState() => _DriverShellState();
}

class _DriverShellState extends ConsumerState<DriverShell> {
  int _index = 0;

  static const _titles = ['GNNcab Driver', 'What I owe', 'Profile'];

  @override
  void initState() {
    super.initState();
    // Arriving here means coming from somewhere else — app start, or back
    // from a job. Re-read so the online toggle and job list can't show a
    // state the driver already saw change.
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      await ref.read(driverProfileProvider.notifier).refresh();
      await ref.read(driverTripsProvider.notifier).refresh();
      // The broadcaster is normally started from setOnline(), but the app can
      // be killed and relaunched while a driver is still online mid-shift —
      // that path never calls setOnline(), so it needs its own check here.
      final profile = ref.read(driverProfileProvider).value;
      if (profile != null && profile.isOnline) {
        ref.read(driverLocationBroadcasterProvider).start();
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(_titles[_index])),
      body: IndexedStack(
        index: _index,
        children: const [DriverHomeTab(), DriverEarningsTab(), DriverProfileTab()],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) {
          setState(() => _index = i);
          if (i == 0) ref.read(driverTripsProvider.notifier).refresh();
          if (i == 1) {
            ref.invalidate(driverBalanceProvider);
            ref.invalidate(driverSessionsProvider);
          }
        },
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.directions_car_outlined),
            selectedIcon: Icon(Icons.directions_car),
            label: 'Jobs',
          ),
          NavigationDestination(
            icon: Icon(Icons.account_balance_wallet_outlined),
            selectedIcon: Icon(Icons.account_balance_wallet),
            label: 'Balance',
          ),
          NavigationDestination(
            icon: Icon(Icons.person_outline),
            selectedIcon: Icon(Icons.person),
            label: 'Profile',
          ),
        ],
      ),
    );
  }
}
