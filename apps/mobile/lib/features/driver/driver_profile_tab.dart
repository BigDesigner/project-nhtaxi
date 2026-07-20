import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../../models/driver_profile.dart';
import '../../widgets/error_banner.dart';
import '../../widgets/help_card.dart';
import '../passenger/passenger_shell.dart' show confirmSignOut;
import 'driver_controllers.dart';

class DriverProfileTab extends ConsumerWidget {
  const DriverProfileTab({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final profile = ref.watch(driverProfileProvider);

    return switch (profile) {
      AsyncLoading() when !profile.hasValue => const Center(child: CircularProgressIndicator()),
      AsyncError(:final error) when !profile.hasValue => Padding(
          padding: const EdgeInsets.all(16),
          child: ErrorBanner(message: error.toString()),
        ),
      AsyncValue(:final value?) => _ProfileBody(profile: value),
      _ => const SizedBox.shrink(),
    };
  }
}

class _ProfileBody extends ConsumerStatefulWidget {
  const _ProfileBody({required this.profile});

  final DriverProfile profile;

  @override
  ConsumerState<_ProfileBody> createState() => _ProfileBodyState();
}

class _ProfileBodyState extends ConsumerState<_ProfileBody> {
  final _formKey = GlobalKey<FormState>();
  late final _make = TextEditingController(text: widget.profile.vehicleMake ?? '');
  late final _model = TextEditingController(text: widget.profile.vehicleModel ?? '');
  late final _colour = TextEditingController(text: widget.profile.vehicleColor ?? '');
  late final _plate = TextEditingController(text: widget.profile.vehiclePlate ?? '');
  late final _year = TextEditingController(text: widget.profile.vehicleYear?.toString() ?? '');
  bool _saving = false;

  @override
  void dispose() {
    for (final c in [_make, _model, _colour, _plate, _year]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() => _saving = true);
    try {
      await ref.read(driverProfileProvider.notifier).updateVehicle({
        // Empty strings would overwrite a good value with nothing; send only
        // what the driver actually filled in.
        if (_make.text.trim().isNotEmpty) 'vehicleMake': _make.text.trim(),
        if (_model.text.trim().isNotEmpty) 'vehicleModel': _model.text.trim(),
        if (_colour.text.trim().isNotEmpty) 'vehicleColor': _colour.text.trim(),
        if (_plate.text.trim().isNotEmpty) 'vehiclePlate': _plate.text.trim().toUpperCase(),
        if (_year.text.trim().isNotEmpty) 'vehicleYear': int.parse(_year.text.trim()),
      });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Vehicle details saved')));
      }
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = widget.profile;

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Center(
          child: CircleAvatar(
            radius: 36,
            child: Text(
              p.firstName.isNotEmpty ? p.firstName[0].toUpperCase() : '?',
              style: const TextStyle(fontSize: 28),
            ),
          ),
        ),
        const SizedBox(height: 12),
        Center(child: Text(p.fullName, style: Theme.of(context).textTheme.titleLarge)),
        Center(
          child: Text(
            p.isVerified ? 'Verified driver · ${p.totalTrips} trips' : 'Awaiting verification',
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ),
        const SizedBox(height: 24),
        Card(
          child: Column(
            children: [
              ListTile(
                leading: const Icon(Icons.email_outlined),
                title: const Text('Email'),
                subtitle: Text(p.email),
              ),
              if (p.phone != null)
                ListTile(
                  leading: const Icon(Icons.phone_outlined),
                  title: const Text('Phone'),
                  subtitle: Text(p.phone!),
                ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Form(
              key: _formKey,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text('Your car', style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 4),
                  Text(
                    'Passengers see this when they pick a driver on the map, and use it '
                    'to spot you at the kerb.',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                  const SizedBox(height: 16),
                  TextFormField(
                    controller: _make,
                    decoration: const InputDecoration(labelText: 'Make', hintText: 'Toyota'),
                    textCapitalization: TextCapitalization.words,
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: _model,
                    decoration: const InputDecoration(labelText: 'Model', hintText: 'Sienna'),
                    textCapitalization: TextCapitalization.words,
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: _colour,
                    decoration: const InputDecoration(labelText: 'Colour', hintText: 'Silver'),
                    textCapitalization: TextCapitalization.words,
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: _plate,
                    decoration: const InputDecoration(labelText: 'Plate', hintText: 'NH 1234'),
                    textCapitalization: TextCapitalization.characters,
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: _year,
                    decoration: const InputDecoration(labelText: 'Year', hintText: '2019'),
                    keyboardType: TextInputType.number,
                    validator: (v) {
                      if (v == null || v.trim().isEmpty) return null;
                      final year = int.tryParse(v.trim());
                      // Mirrors the API's own bounds, so a typo is caught here
                      // rather than coming back as a 400.
                      if (year == null || year < 1980 || year > 2100) return 'Enter a year like 2019';
                      return null;
                    },
                  ),
                  const SizedBox(height: 16),
                  FilledButton(
                    onPressed: _saving ? null : _save,
                    child: _saving
                        ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
                        : const Text('Save vehicle details'),
                  ),
                ],
              ),
            ),
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
