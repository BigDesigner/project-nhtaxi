import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/api_client.dart';
import '../../models/driver_document.dart';
import '../../widgets/error_banner.dart';
import 'driver_controllers.dart';

/// Licence and background check, on the driver's Profile tab.
///
/// These gate everything: under RSA 376-A a driver cannot carry passengers
/// without them, and the office cannot honestly approve anyone until it has
/// seen them. Uploads are encrypted server-side before storage — the driver
/// agreement says so, and this is the screen that makes it true.
///
/// Camera and gallery only. A file picker that also took PDFs conflicts with
/// the location plugin, and location is core to this app; photographing a
/// licence is the normal case anyway. A driver with a PDF background check
/// can screenshot it.
class DriverDocumentsSection extends ConsumerWidget {
  const DriverDocumentsSection({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final docs = ref.watch(driverDocumentsProvider);

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Your documents', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 4),
            Text(
              'The office needs these before you can be approved to drive. They are '
              'encrypted before they are stored, and only the office can open them — '
              'never passengers, never other drivers.',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 12),
            switch (docs) {
              AsyncLoading() when !docs.hasValue => const Padding(
                  padding: EdgeInsets.symmetric(vertical: 24),
                  child: Center(child: CircularProgressIndicator()),
                ),
              AsyncError(:final error) when !docs.hasValue => ErrorBanner(message: error.toString()),
              AsyncValue(:final value?) => Column(
                  children: [
                    for (final type in requiredDocumentTypes)
                      _DocumentRow(
                        type: type,
                        // Most recent upload of this type wins: a rejected
                        // document is replaced by uploading again, and the
                        // driver should see the state of the new one.
                        latest: _latestOfType(value, type),
                      ),
                  ],
                ),
              _ => const SizedBox.shrink(),
            },
          ],
        ),
      ),
    );
  }

  static DriverDocument? _latestOfType(List<DriverDocument> all, String type) {
    final matching = all.where((d) => d.type == type).toList()
      ..sort((a, b) => b.uploadedAt.compareTo(a.uploadedAt));
    return matching.isEmpty ? null : matching.first;
  }
}

class _DocumentRow extends ConsumerStatefulWidget {
  const _DocumentRow({required this.type, required this.latest});

  final String type;
  final DriverDocument? latest;

  @override
  ConsumerState<_DocumentRow> createState() => _DocumentRowState();
}

class _DocumentRowState extends ConsumerState<_DocumentRow> {
  bool _uploading = false;

  Future<void> _upload(ImageSource source) async {
    final picked = await ImagePicker().pickImage(
      source: source,
      // Big enough to read a licence number, small enough to upload on a bad
      // signal. The API caps at 10 MB.
      maxWidth: 2000,
      maxHeight: 2000,
      imageQuality: 90,
    );
    if (picked == null || !mounted) return;

    setState(() => _uploading = true);
    try {
      final bytes = await picked.readAsBytes();
      final contentType = picked.mimeType ?? _mimeFromName(picked.name);
      await uploadDriverDocument(ref, widget.type, bytes, contentType);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Uploaded — the office will review it')),
        );
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
    if (lower.endsWith('.pdf')) return 'application/pdf';
    return 'image/jpeg';
  }

  Future<void> _pickSource() async {
    final source = await showModalBottomSheet<ImageSource>(
      context: context,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.photo_camera),
              title: const Text('Take a photo'),
              onTap: () => Navigator.pop(context, ImageSource.camera),
            ),
            ListTile(
              leading: const Icon(Icons.photo_library_outlined),
              title: const Text('Choose from gallery'),
              onTap: () => Navigator.pop(context, ImageSource.gallery),
            ),
          ],
        ),
      ),
    );
    if (source != null) await _upload(source);
  }

  ({Color color, IconData icon}) get _state {
    final doc = widget.latest;
    if (doc == null) return (color: Colors.orange, icon: Icons.upload_file);
    if (doc.isApproved) return (color: Colors.green, icon: Icons.verified);
    if (doc.isRejected) return (color: Colors.red, icon: Icons.error_outline);
    return (color: Colors.blue, icon: Icons.hourglass_bottom);
  }

  @override
  Widget build(BuildContext context) {
    final doc = widget.latest;
    final label = DriverDocument(
      id: '',
      type: widget.type,
      status: 'PENDING',
      uploadedAt: DateTime.now(),
    ).typeLabel;
    final s = _state;

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Icon(s.icon, color: s.color, size: 20),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label, style: Theme.of(context).textTheme.bodyLarge),
                Text(
                  doc?.statusLabel ?? 'Not uploaded yet',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(color: s.color),
                ),
              ],
            ),
          ),
          if (_uploading)
            const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
          // An approved document is write-once server-side, so offering to
          // replace it would be offering something that will be refused.
          else if (doc?.isApproved ?? false)
            const SizedBox.shrink()
          else
            TextButton(
              onPressed: _pickSource,
              child: Text(doc == null ? 'Upload' : 'Replace'),
            ),
        ],
      ),
    );
  }
}
