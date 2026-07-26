import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../auth/change_password_sheet.dart';
import '../../widgets/brand_header_bar.dart';
import '../../widgets/help_card.dart';
import '../auth/auth_controller.dart';
import 'customer_profile_controller.dart';
import 'passenger_home_screen.dart';
import 'tawk_chat_screen.dart';
import 'trips_tab.dart';
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

  static const _titles = ['Home', 'Your trips', 'Profile', 'Settings'];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: BrandHeaderBar(subtitle: _titles[_index]),
      body: IndexedStack(
        index: _index,
        children: const [PassengerHomeTab(), PassengerTripsTab(), _ProfileTab(), _SettingsTab()],
      ),
      // Present on every tab, not just one — a passenger stuck on any screen
      // can reach a person without hunting for it.
      floatingActionButton: FloatingActionButton(
        tooltip: 'Chat with us',
        onPressed: () => openTawkChat(context),
        child: const Icon(Icons.chat_bubble_outline),
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) {
          setState(() => _index = i);
          // Coming back to either list is the moment stale data shows up.
          if (i == 0 || i == 1) ref.read(tripsControllerProvider.notifier).refresh();
        },
        destinations: const [
          NavigationDestination(icon: Icon(Icons.home_outlined), selectedIcon: Icon(Icons.home), label: 'Home'),
          NavigationDestination(
            icon: Icon(Icons.receipt_long_outlined),
            selectedIcon: Icon(Icons.receipt_long),
            label: 'Trips',
          ),
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
    // Supplementary, not load-bearing — the profile screen still works fine
    // without it, so a slow or failed fetch just means the row doesn't show.
    final totalTrips = ref.watch(customerProfileProvider).value?.totalTrips;

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
              if (totalTrips != null)
                ListTile(
                  leading: const Icon(Icons.receipt_long_outlined),
                  title: const Text('Trips taken'),
                  subtitle: Text('$totalTrips'),
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
        FilledButton.icon(
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
                title: Text('Where we drive'),
                // Based in North Conway but the business runs long-distance
                // work — Boston runs are routine and New York happens. Saying
                // "North Conway, NH" made it look like a village-only service
                // and left passengers guessing whether to even ask.
                subtitle: Text(
                  'Based in North Conway, NH. We cover all of New England '
                  '(NH, ME, VT, MA, RI, CT) and run long-distance trips across '
                  'the wider Northeast, including New York and Pennsylvania — '
                  'airport runs to Boston and Portland are routine. Going '
                  'somewhere else? Call us and ask.',
                ),
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
        Card(
          child: ListTile(
            leading: const Icon(Icons.lock_outline),
            title: const Text('Change password'),
            subtitle: const Text('Signs you out on other devices'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => showChangePasswordSheet(context, ref),
          ),
        ),
        const SizedBox(height: 16),
        const HelpCard(),
        const SizedBox(height: 16),
        // Also reachable from Profile. Settings is where people go looking for
        // it, so it lives in both rather than only the less obvious one.
        FilledButton.icon(
          onPressed: () => confirmSignOut(context, ref),
          icon: const Icon(Icons.logout),
          label: const Text('Sign out'),
        ),
      ],
    );
  }
}
