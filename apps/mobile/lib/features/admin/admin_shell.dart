import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'admin_controllers.dart';
import 'admin_drivers_tab.dart';
import 'admin_fleet_map_tab.dart';
import 'admin_money_tab.dart';
import 'admin_settings_tab.dart';
import 'admin_trips_tab.dart';

/// Drivers / Map / Trips / Money / Settings.
class AdminShell extends ConsumerStatefulWidget {
  const AdminShell({super.key});

  @override
  ConsumerState<AdminShell> createState() => _AdminShellState();
}

class _AdminShellState extends ConsumerState<AdminShell> {
  int _index = 0;

  static const _titles = ['Drivers', 'Live map', 'Trips', 'Money', 'Settings'];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(_titles[_index])),
      body: IndexedStack(
        index: _index,
        children: const [
          AdminDriversTab(),
          AdminFleetMapTab(),
          AdminTripsTab(),
          AdminMoneyTab(),
          AdminSettingsTab(),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) {
          setState(() => _index = i);
          // Reports go stale the moment anyone does anything, and the office
          // is usually looking at them precisely because something changed.
          // The map needs no invalidation — it's a live socket, not a fetch.
          switch (i) {
            case 0:
              ref.invalidate(adminDriversProvider);
            case 2:
              ref.invalidate(adminTripsProvider);
            case 3:
              ref.invalidate(driverBalancesProvider);
              ref.invalidate(cashCollectionsProvider);
          }
        },
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.people_outline),
            selectedIcon: Icon(Icons.people),
            label: 'Drivers',
          ),
          NavigationDestination(
            icon: Icon(Icons.map_outlined),
            selectedIcon: Icon(Icons.map),
            label: 'Map',
          ),
          NavigationDestination(
            icon: Icon(Icons.receipt_long_outlined),
            selectedIcon: Icon(Icons.receipt_long),
            label: 'Trips',
          ),
          NavigationDestination(
            icon: Icon(Icons.payments_outlined),
            selectedIcon: Icon(Icons.payments),
            label: 'Money',
          ),
          NavigationDestination(
            icon: Icon(Icons.settings_outlined),
            selectedIcon: Icon(Icons.settings),
            label: 'Settings',
          ),
        ],
      ),
    );
  }
}
