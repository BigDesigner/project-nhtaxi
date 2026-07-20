import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api_client.dart';
import '../../core/geocoding.dart';
import '../../models/admin.dart';
import '../../widgets/app_back_button.dart';
import '../../widgets/error_banner.dart';
import '../../widgets/map_markers.dart';
import '../passenger/booking/address_search_sheet.dart';
import '../passenger/booking/pin_picker_screen.dart';
import 'admin_controllers.dart';

/// A job taken over the phone and handed to a chosen driver.
///
/// This is the flow that owes GNN LLC a commission, which the driver app
/// discloses before they accept. Deliberately guest-only: someone ringing the
/// office usually has no app account, and looking one up would slow down the
/// call. The passenger app's own bookings cover registered customers.
class AdminAssignTripScreen extends ConsumerStatefulWidget {
  const AdminAssignTripScreen({super.key});

  @override
  ConsumerState<AdminAssignTripScreen> createState() => _AdminAssignTripScreenState();
}

class _AdminAssignTripScreenState extends ConsumerState<AdminAssignTripScreen> {
  final _formKey = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _phone = TextEditingController();
  final _notes = TextEditingController();

  String? _driverId;
  GeoPlace? _pickup;
  GeoPlace? _dropoff;
  bool _submitting = false;
  String? _error;

  @override
  void dispose() {
    for (final c in [_name, _phone, _notes]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _pickPlace({required bool isPickup}) async {
    final place = await showModalBottomSheet<GeoPlace>(
      context: context,
      isScrollControlled: true,
      builder: (_) => AddressSearchSheet(title: isPickup ? 'Pick-up address' : 'Destination'),
    );
    if (place == null || !mounted) return;

    final confirmed = await Navigator.of(context).push<GeoPlace>(
      MaterialPageRoute(
        builder: (_) => PinPickerScreen(
          title: isPickup ? 'Confirm pick-up' : 'Confirm destination',
          initial: place.point,
          isPickup: isPickup,
          initialAddress: place.displayName,
        ),
      ),
    );
    if (confirmed == null || !mounted) return;
    setState(() => isPickup ? _pickup = confirmed : _dropoff = confirmed);
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    if (_driverId == null) {
      setState(() => _error = 'Choose a driver for this job.');
      return;
    }
    if (_pickup == null) {
      setState(() => _error = 'Set a pick-up address.');
      return;
    }

    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      await assignTripToDriver(
        ref,
        driverId: _driverId!,
        pickupLat: _pickup!.point.latitude,
        pickupLng: _pickup!.point.longitude,
        pickupAddress: _pickup!.shortName,
        guestName: _name.text.trim(),
        guestPhone: _phone.text.trim(),
        dropoffLat: _dropoff?.point.latitude,
        dropoffLng: _dropoff?.point.longitude,
        dropoffAddress: _dropoff?.shortName,
        notes: _notes.text.trim(),
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Job sent to the driver')),
      );
      context.go('/home');
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final drivers = ref.watch(adminDriversProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Assign a job'), leading: const AppBackButton()),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (_error != null) ...[
              ErrorBanner(message: _error!),
              const SizedBox(height: 16),
            ],
            Text('Who is travelling', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 12),
            TextFormField(
              controller: _name,
              decoration: const InputDecoration(labelText: 'Name'),
              textCapitalization: TextCapitalization.words,
              validator: (v) => (v == null || v.trim().isEmpty) ? 'Name is required' : null,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _phone,
              decoration: const InputDecoration(labelText: 'Phone'),
              keyboardType: TextInputType.phone,
              validator: (v) =>
                  (v == null || v.trim().length < 7) ? 'A phone number is required' : null,
            ),
            const SizedBox(height: 24),
            Text('Where', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            _PlaceRow(
              isPickup: true,
              label: 'Pick-up',
              value: _pickup?.shortName,
              onTap: () => _pickPlace(isPickup: true),
            ),
            const Divider(height: 8),
            _PlaceRow(
              isPickup: false,
              label: 'Destination',
              // Genuinely optional — the API allows a trip with no dropoff and
              // the driver fills it in at pickup.
              value: _dropoff?.shortName,
              placeholder: 'Optional — driver can set it at pick-up',
              onTap: () => _pickPlace(isPickup: false),
            ),
            const SizedBox(height: 24),
            Text('Which driver', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 4),
            Text(
              'They will be told the commission before they accept.',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 12),
            switch (drivers) {
              AsyncLoading() => const Center(child: CircularProgressIndicator()),
              AsyncError(:final error) => ErrorBanner(message: error.toString()),
              AsyncData(:final value) => _DriverPicker(
                  // Only approved drivers can be given work at all.
                  drivers: value.where((d) => d.isVerified).toList(),
                  selectedId: _driverId,
                  onSelected: (id) => setState(() => _driverId = id),
                ),
            },
            const SizedBox(height: 24),
            TextFormField(
              controller: _notes,
              decoration: const InputDecoration(labelText: 'Notes for the driver (optional)'),
              maxLines: 2,
            ),
            const SizedBox(height: 24),
            FilledButton(
              onPressed: _submitting ? null : _submit,
              style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 16)),
              child: _submitting
                  ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Text('Send job to driver'),
            ),
          ],
        ),
      ),
    );
  }
}

class _PlaceRow extends StatelessWidget {
  const _PlaceRow({
    required this.isPickup,
    required this.label,
    required this.value,
    required this.onTap,
    this.placeholder,
  });

  final bool isPickup;
  final String label;
  final String? value;
  final String? placeholder;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 12),
        child: Row(
          children: [
            SizedBox(width: 20, child: Center(child: LegendDot(isPickup: isPickup))),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(label, style: Theme.of(context).textTheme.bodySmall),
                  Text(
                    value ?? placeholder ?? 'Tap to choose',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: value == null
                        ? TextStyle(color: Theme.of(context).hintColor)
                        : Theme.of(context).textTheme.bodyLarge,
                  ),
                ],
              ),
            ),
            const Icon(Icons.chevron_right),
          ],
        ),
      ),
    );
  }
}

class _DriverPicker extends StatelessWidget {
  const _DriverPicker({
    required this.drivers,
    required this.selectedId,
    required this.onSelected,
  });

  final List<AdminDriver> drivers;
  final String? selectedId;
  final ValueChanged<String> onSelected;

  @override
  Widget build(BuildContext context) {
    if (drivers.isEmpty) {
      return const Card(
        child: Padding(
          padding: EdgeInsets.all(16),
          child: Text('No approved drivers yet. Approve someone on the Drivers tab first.'),
        ),
      );
    }

    // RadioGroup owns the selection now; RadioListTile's own groupValue and
    // onChanged were deprecated after Flutter 3.32.
    return RadioGroup<String>(
      groupValue: selectedId,
      onChanged: (v) {
        if (v != null) onSelected(v);
      },
      child: Column(
        children: [
          for (final d in drivers)
            Card(
              margin: const EdgeInsets.only(bottom: 4),
              child: RadioListTile<String>(
                value: d.id,
                title: Text(d.fullName),
                subtitle: Text(
                  [
                    d.status.toLowerCase(),
                    if (d.vehicleDescription != null) d.vehicleDescription!,
                  ].join(' · '),
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ),
            ),
        ],
      ),
    );
  }
}
