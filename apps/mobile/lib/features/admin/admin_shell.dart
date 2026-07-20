import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'admin_controllers.dart';
import 'admin_drivers_tab.dart';
import 'admin_money_tab.dart';
import 'admin_settings_tab.dart';
import 'admin_trips_tab.dart';

/// Drivers / Trips / Money / Settings.
class AdminShell extends ConsumerStatefulWidget {
  const AdminShell({super.key});

  @override
  ConsumerState<AdminShell> createState() => _AdminShellState();
}

class _AdminShellState extends ConsumerState<AdminShell> {
  int _index = 0;

  static const _titles = ['Drivers', 'Trips', 'Money', 'Settings'];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(_titles[_index])),
      body: IndexedStack(
        index: _index,
        children: const [AdminDriversTab(), AdminTripsTab(), AdminMoneyTab(), AdminSettingsTab()],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) {
          setState(() => _index = i);
          // Reports go stale the moment anyone does anything, and the office
          // is usually looking at them precisely because something changed.
          switch (i) {
            case 0:
              ref.invalidate(adminDriversProvider);
            case 1:
              ref.invalidate(adminTripsProvider);
            case 2:
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
