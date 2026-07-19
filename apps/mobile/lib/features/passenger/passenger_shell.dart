import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../widgets/help_card.dart';
import '../auth/auth_controller.dart';
import 'passenger_home_screen.dart';
import 'trips_controller.dart';

/// Home / Profile / Settings shell.
class PassengerShell extends ConsumerStatefulWidget {
  const PassengerShell({super.key});

  @override
  ConsumerState<PassengerShell> createState() => _PassengerShellState();
}

class _PassengerShellState extends ConsumerState<PassengerShell> {
  int _index = 0;

  @override
  void initState() {
    super.initState();
    // Landing here always means arriving from somewhere else — app start, or
    // back from a trip. Re-read the list so the card can't show a status the
    // passenger already saw change on the trip screen. refresh() keeps the
    // old rows visible while it loads, so this costs no flicker.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(tripsControllerProvider.notifier).refresh();
    });
  }

  static const _titles = ['GNNcab', 'Profile', 'Settings'];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(_titles[_index])),
      body: IndexedStack(
        index: _index,
        children: const [PassengerHomeTab(), _ProfileTab(), _SettingsTab()],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) {
          setState(() => _index = i);
          // Coming back to the list is the other moment stale data shows up.
          if (i == 0) ref.read(tripsControllerProvider.notifier).refresh();
        },
        destinations: const [
          NavigationDestination(icon: Icon(Icons.home_outlined), selectedIcon: Icon(Icons.home), label: 'Home'),
          NavigationDestination(icon: Icon(Icons.person_outline), selectedIcon: Icon(Icons.person), label: 'Profile'),
          NavigationDestination(icon: Icon(Icons.settings_outlined), selectedIcon: Icon(Icons.settings), label: 'Settings'),
        ],
      ),
    );
  }
}

/// Signing out drops the session and any unsaved context, so it asks first —
/// it used to fire on a single stray tap.
Future<void> confirmSignOut(BuildContext context, WidgetRef ref) async {
  final confirmed = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: const Text('Sign out?'),
      content: const Text("You'll need to sign in again to book a trip."),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Stay signed in')),
        FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Sign out')),
      ],
    ),
  );
  if (confirmed == true) {
    await ref.read(authControllerProvider.notifier).logout();
  }
}

class _ProfileTab extends ConsumerWidget {
  const _ProfileTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(authControllerProvider).value;
    if (user == null) return const Center(child: CircularProgressIndicator());

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Center(
          child: CircleAvatar(
            radius: 36,
            child: Text(
              user.firstName.isNotEmpty ? user.firstName[0].toUpperCase() : '?',
              style: const TextStyle(fontSize: 28),
            ),
          ),
        ),
        const SizedBox(height: 16),
        Center(child: Text(user.fullName, style: Theme.of(context).textTheme.titleLarge)),
        const SizedBox(height: 24),
        Card(
          child: Column(
            children: [
              ListTile(leading: const Icon(Icons.email_outlined), title: const Text('Email'), subtitle: Text(user.email)),
              if (user.phone != null)
                ListTile(
                  leading: const Icon(Icons.phone_outlined),
                  title: const Text('Phone'),
                  subtitle: Text(user.phone!),
                ),
              ListTile(
                leading: const Icon(Icons.badge_outlined),
                title: const Text('Account type'),
                subtitle: Text(user.role),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        const HelpCard(),
        const SizedBox(height: 16),
        OutlinedButton.icon(
          onPressed: () => confirmSignOut(context, ref),
          icon: const Icon(Icons.logout),
          label: const Text('Sign out'),
        ),
      ],
    );
  }
}

class _SettingsTab extends ConsumerWidget {
  const _SettingsTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Card(
          child: Column(
            children: [
              const ListTile(
                leading: Icon(Icons.payments_outlined),
                title: Text('Payment'),
                subtitle: Text('Cash — you pay the driver directly'),
              ),
              const ListTile(
                leading: Icon(Icons.place_outlined),
                title: Text('Service area'),
                subtitle: Text('North Conway, NH'),
              ),
              ListTile(
                leading: const Icon(Icons.map_outlined),
                title: const Text('Maps'),
                subtitle: Text('OpenStreetMap', style: Theme.of(context).textTheme.bodySmall),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        const HelpCard(),
      ],
    );
  }
}
