import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../../models/admin.dart';
import '../../widgets/error_banner.dart';
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
            'Quotes are worked out from an estimated road distance, then shown to the '
            'passenger as this figure with a 10% ceiling above it.',
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
          OutlinedButton.icon(
            onPressed: () => confirmSignOut(context, ref),
            icon: const Icon(Icons.logout),
            label: const Text('Sign out'),
          ),
        ],
      ),
    );
  }

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
