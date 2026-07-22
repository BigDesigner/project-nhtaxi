import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../auth/auth_controller.dart';
import '../auth/change_password_sheet.dart';
import '../../core/api_client.dart';
import '../../core/view_mode.dart';
import '../../models/driver_profile.dart';
import '../../widgets/driver_avatar.dart';
import '../../widgets/error_banner.dart';
import '../../widgets/help_card.dart';
import '../../widgets/star_rating.dart';
import '../passenger/passenger_shell.dart' show confirmSignOut;
import 'driver_controllers.dart';
import 'driver_documents_section.dart';

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
  bool _uploading = false;

  /// Bumped after an upload to force the avatar to re-fetch. The provider is
  /// keyed on the URL, which doesn't change when the photo behind it does.
  int _photoVersion = 0;

  Future<void> _pickPhoto() async {
    final picked = await ImagePicker().pickImage(
      source: ImageSource.gallery,
      // Resized before upload: a modern phone camera produces several MB, the
      // API caps at 2, and it's only ever rendered as a small circle.
      maxWidth: 800,
      maxHeight: 800,
      imageQuality: 85,
    );
    if (picked == null || !mounted) return;

    setState(() => _uploading = true);
    try {
      final bytes = await picked.readAsBytes();
      // image_picker reports the MIME type on web but not always on native;
      // fall back to the extension, and to JPEG since that's what the resize
      // above produces.
      final contentType = picked.mimeType ?? _mimeFromName(picked.name);
      await ref.read(driverProfileProvider.notifier).uploadPhoto(bytes, contentType);
      if (mounted) {
        setState(() => _photoVersion++);
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Photo updated')));
      }
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  String _mimeFromName(String name) {
    final lower = name.toLowerCase();
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.webp')) return 'image/webp';
    return 'image/jpeg';
  }

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
          child: Stack(
            alignment: Alignment.bottomRight,
            children: [
              DriverAvatar(
                name: p.firstName,
                // Own photo, via the same authenticated route passengers use.
                photoUrl: '/api/drivers/${p.id}/photo',
                radius: 44,
                key: ValueKey(_photoVersion),
              ),
              Material(
                color: Theme.of(context).colorScheme.primary,
                shape: const CircleBorder(),
                child: InkWell(
                  customBorder: const CircleBorder(),
                  onTap: _uploading ? null : _pickPhoto,
                  child: Padding(
                    padding: const EdgeInsets.all(6),
                    child: _uploading
                        ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                        : Icon(Icons.photo_camera, size: 16, color: Theme.of(context).colorScheme.onPrimary),
                  ),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 8),
        Center(
          child: Text(
            'Passengers see this photo when they choose a driver.',
            style: Theme.of(context).textTheme.bodySmall,
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
        if (p.rating != null && p.ratingCount > 0) ...[
          const SizedBox(height: 8),
          Center(
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                StarDisplay(value: p.rating!, size: 18),
                const SizedBox(width: 8),
                Text(
                  '${p.rating!.toStringAsFixed(1)} from ${p.ratingCount} ${p.ratingCount == 1 ? 'rating' : 'ratings'}',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ],
            ),
          ),
        ],
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
        const DriverDocumentsSection(),
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
        if (ref.watch(authControllerProvider).value?.canSwitchRoleView == true) ...[
          const SizedBox(height: 16),
          Card(
            child: ListTile(
              leading: const Icon(Icons.admin_panel_settings_outlined),
              title: const Text('Admin panel'),
              subtitle: const Text('Switch to the office view'),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => ref.read(viewModeProvider.notifier).set('admin'),
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
