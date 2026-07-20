import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api_client.dart';
import '../../core/view_mode.dart';
import '../../models/admin.dart';
import '../../widgets/error_banner.dart';
import '../auth/auth_controller.dart';
import '../auth/change_password_sheet.dart';
import '../passenger/passenger_shell.dart' show confirmSignOut;
import 'admin_controllers.dart';

/// The rate card, and the only place either revenue stream can be changed.
class AdminSettingsTab extends ConsumerWidget {
  const AdminSettingsTab({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final pricing = ref.watch(pricingConfigProvider);

    return switch (pricing) {
      AsyncLoading() => const Center(child: CircularProgressIndicator()),
      AsyncError(:final error) => ListView(
          padding: const EdgeInsets.all(16),
          children: [ErrorBanner(message: error.toString())],
        ),
      AsyncData(:final value) => _PricingForm(key: ValueKey(value.id), config: value),
    };
  }
}

class _PricingForm extends ConsumerStatefulWidget {
  const _PricingForm({super.key, required this.config});

  final PricingConfig config;

  @override
  ConsumerState<_PricingForm> createState() => _PricingFormState();
}

class _PricingFormState extends ConsumerState<_PricingForm> {
  final _formKey = GlobalKey<FormState>();
  late final _baseFare = TextEditingController(text: widget.config.baseFare.toStringAsFixed(2));
  late final _perMile = TextEditingController(text: widget.config.perMile.toStringAsFixed(2));
  late final _usage = TextEditingController(text: widget.config.driverUsagePerMinute.toStringAsFixed(2));
  late final _commission =
      TextEditingController(text: widget.config.driverCommissionPercent.toStringAsFixed(0));
  bool _saving = false;

  @override
  void dispose() {
    for (final c in [_baseFare, _perMile, _usage, _commission]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() => _saving = true);
    try {
      await updatePricing(
        ref,
        baseFare: double.parse(_baseFare.text.trim()),
        perMile: double.parse(_perMile.text.trim()),
        driverUsagePerMinute: double.parse(_usage.text.trim()),
        driverCommissionPercent: double.parse(_commission.text.trim()),
      );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Pricing updated')));
      }
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Form(
      key: _formKey,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text('What passengers pay', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 4),
          Text(
            'Quotes are worked out from the real driving distance for the route, then '
            'shown to the passenger as that figure with a 10% ceiling above it.',
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height: 12),
          _money(_baseFare, 'Base fare'),
          const SizedBox(height: 12),
          _money(_perMile, 'Per mile'),
          const SizedBox(height: 28),
          Text('What drivers pay GNN LLC', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 4),
          Text(
            'Charged for every minute a driver is online, plus a share of the fare on '
            'jobs the office assigns directly.',
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height: 12),
          _money(_usage, 'Per minute online'),
          const SizedBox(height: 12),
          TextFormField(
            controller: _commission,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: const InputDecoration(labelText: 'Commission on assigned jobs', suffixText: '%'),
            validator: (v) {
              final n = double.tryParse((v ?? '').trim());
              if (n == null || n < 0 || n > 100) return 'Enter a percentage between 0 and 100';
              return null;
            },
          ),
          const SizedBox(height: 24),
          FilledButton(
            onPressed: _saving ? null : _save,
            style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 16)),
            child: _saving
                ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
                : const Text('Save pricing'),
          ),
          const SizedBox(height: 32),
          Card(
            child: Column(
              children: [
                ListTile(
                  leading: const Icon(Icons.people_outline),
                  title: const Text('People'),
                  subtitle: const Text('Add office staff, deactivate accounts'),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => context.go('/home/people'),
                ),
                ListTile(
                  leading: const Icon(Icons.location_city_outlined),
                  title: const Text('Service areas'),
                  subtitle: const Text('Cities this business covers'),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => _showCities(context, ref),
                ),
                ListTile(
                  leading: const Icon(Icons.history),
                  title: const Text('Activity log'),
                  subtitle: const Text('Who changed what, and when'),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => context.go('/home/activity'),
                ),
              ],
            ),
          ),
          if (ref.watch(authControllerProvider).value?.canSwitchRoleView == true) ...[
            const SizedBox(height: 16),
            Card(
              child: ListTile(
                leading: const Icon(Icons.directions_car_outlined),
                title: const Text('Driver app'),
                subtitle: const Text('Switch back to your driver screens'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => ref.read(viewModeProvider.notifier).set('driver'),
              ),
            ),
          ],
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
          OutlinedButton.icon(
            onPressed: () => confirmSignOut(context, ref),
            icon: const Icon(Icons.logout),
            label: const Text('Sign out'),
          ),
        ],
      ),
    );
  }

  Future<void> _showCities(BuildContext context, WidgetRef ref) =>
      showDialog<void>(context: context, builder: (_) => const _CitiesDialog());

  Widget _money(TextEditingController controller, String label) {
    return TextFormField(
      controller: controller,
      keyboardType: const TextInputType.numberWithOptions(decimal: true),
      decoration: InputDecoration(labelText: label, prefixText: r'$'),
      validator: (v) {
        final n = double.tryParse((v ?? '').trim());
        if (n == null || n < 0) return 'Enter an amount';
        // The API rejects sub-cent precision; catching it here beats a 400.
        if ((n * 100) % 1 != 0) return 'Use at most two decimal places';
        return null;
      },
    );
  }
}


/// Service areas. Small enough to live in a dialog rather than its own screen
/// — a business with fifteen drivers is not managing dozens of cities.
class _CitiesDialog extends ConsumerStatefulWidget {
  const _CitiesDialog();

  @override
  ConsumerState<_CitiesDialog> createState() => _CitiesDialogState();
}

class _CitiesDialogState extends ConsumerState<_CitiesDialog> {
  final _name = TextEditingController();
  final _state = TextEditingController(text: 'NH');
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    _name.dispose();
    _state.dispose();
    super.dispose();
  }

  Future<void> _remove(BuildContext context, City city) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Remove this service area?'),
        content: Text('"${city.label}" will no longer be listed.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Remove')),
        ],
      ),
    );
    if (confirmed != true) return;

    try {
      await deleteCity(ref, city.id);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  Future<void> _add() async {
    if (_name.text.trim().isEmpty) return;

    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await createCity(
        ref,
        name: _name.text.trim(),
        state: _state.text.trim().isEmpty ? null : _state.text.trim(),
      );
      _name.clear();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final cities = ref.watch(citiesProvider);

    return AlertDialog(
      title: const Text('Service areas'),
      content: SizedBox(
        width: 400,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (_error != null) ...[
              Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
              const SizedBox(height: 8),
            ],
            Flexible(
              child: switch (cities) {
                AsyncLoading() => const Padding(
                  padding: EdgeInsets.all(24),
                  child: CircularProgressIndicator(),
                ),
                AsyncError(:final error) => Text('$error'),
                AsyncData(:final value) when value.isEmpty => const Padding(
                  padding: EdgeInsets.all(16),
                  child: Text('No cities added yet.'),
                ),
                AsyncData(:final value) => ListView(
                  shrinkWrap: true,
                  children: [
                    for (final c in value)
                      ListTile(
                        dense: true,
                        leading: const Icon(Icons.place_outlined),
                        title: Text(c.label),
                        subtitle: Text(c.timezone, style: Theme.of(context).textTheme.bodySmall),
                        trailing: IconButton(
                          tooltip: 'Remove',
                          icon: const Icon(Icons.delete_outline, size: 20),
                          onPressed: () => _remove(context, c),
                        ),
                      ),
                  ],
                ),
              },
            ),
            const Divider(),
            Row(
              children: [
                Expanded(
                  flex: 3,
                  child: TextField(
                    controller: _name,
                    decoration: const InputDecoration(labelText: 'City'),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: TextField(
                    controller: _state,
                    decoration: const InputDecoration(labelText: 'State'),
                  ),
                ),
                const SizedBox(width: 8),
                if (_saving)
                  const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                else
                  IconButton(icon: const Icon(Icons.add), onPressed: _add),
              ],
            ),
          ],
        ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('Done')),
      ],
    );
  }
}
