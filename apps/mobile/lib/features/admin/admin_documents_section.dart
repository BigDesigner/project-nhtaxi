import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../../models/admin.dart';
import '../../models/driver_document.dart';
import 'admin_controllers.dart';

/// The documents the office reviews before approving a driver, and the
/// Approve button itself.
///
/// These are together on purpose. Approving grants someone the right to carry
/// passengers, and it used to sit on a screen with nothing to review — a
/// button that did something serious with no evidence in front of it. It now
/// lives underneath the paperwork, and warns when the paperwork isn't there.
class AdminDocumentsSection extends ConsumerWidget {
  const AdminDocumentsSection({super.key, required this.driverId});

  final String driverId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final detail = ref.watch(adminDriverDetailProvider(driverId));

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: switch (detail) {
          AsyncLoading() => const Padding(
            padding: EdgeInsets.symmetric(vertical: 24),
            child: Center(child: CircularProgressIndicator()),
          ),
          AsyncError(:final error) => Text('Could not load documents: $error'),
          AsyncData(:final value) => _Body(driverId: driverId, detail: value),
        },
      ),
    );
  }
}

class _Body extends ConsumerStatefulWidget {
  const _Body({required this.driverId, required this.detail});

  final String driverId;
  final AdminDriverDetail detail;

  @override
  ConsumerState<_Body> createState() => _BodyState();
}

class _BodyState extends ConsumerState<_Body> {
  bool _busy = false;

  Future<void> _setVerified(bool verified) async {
    final detail = widget.detail;

    // Approving without having approved the paperwork is allowed but not
    // silent: RSA 376-A eligibility rests on the licence and background
    // check, and this is the moment somebody becomes able to carry
    // passengers. If the office wants to override, it does so knowingly.
    if (verified && !detail.hasAllRequiredApproved) {
      final ok = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('Approve without the paperwork?'),
          content: const Text(
            "This driver's licence and background check have not both been approved. "
            'Approving now lets them start carrying passengers.',
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
            FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Approve anyway')),
          ],
        ),
      );
      if (ok != true) return;
    }

    if (!verified) {
      if (!mounted) return;
      final ok = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text('Suspend ${detail.driver.firstName}?'),
          content: const Text(
            'They will be taken offline and will not receive any more jobs until you '
            'approve them again.',
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
            FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Suspend')),
          ],
        ),
      );
      if (ok != true) return;
    }

    setState(() => _busy = true);
    try {
      await setDriverVerified(ref, widget.driverId, verified);
      ref.invalidate(adminDriverDetailProvider(widget.driverId));
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final detail = widget.detail;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('Documents', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        for (final type in requiredDocumentTypes)
          _DocumentTile(
            driverId: widget.driverId,
            type: type,
            document: _latestOfType(detail.documents, type),
          ),
        const Divider(height: 28),
        if (!detail.hasAllRequiredApproved)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Row(
              children: [
                const Icon(Icons.warning_amber, size: 18, color: Colors.orange),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Not all required documents are approved.',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ),
              ],
            ),
          ),
        if (_busy)
          const Center(child: CircularProgressIndicator())
        else if (detail.driver.isVerified)
          OutlinedButton.icon(
            onPressed: () => _setVerified(false),
            icon: const Icon(Icons.block),
            label: const Text('Suspend this driver'),
          )
        else
          FilledButton.icon(
            onPressed: () => _setVerified(true),
            icon: const Icon(Icons.verified),
            label: const Text('Approve to drive'),
            style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 16)),
          ),
      ],
    );
  }

  static DriverDocument? _latestOfType(List<DriverDocument> all, String type) {
    final matching = all.where((d) => d.type == type).toList()
      ..sort((a, b) => b.uploadedAt.compareTo(a.uploadedAt));
    return matching.isEmpty ? null : matching.first;
  }
}

class _DocumentTile extends ConsumerStatefulWidget {
  const _DocumentTile({required this.driverId, required this.type, required this.document});

  final String driverId;
  final String type;
  final DriverDocument? document;

  @override
  ConsumerState<_DocumentTile> createState() => _DocumentTileState();
}

class _DocumentTileState extends ConsumerState<_DocumentTile> {
  bool _busy = false;

  Future<void> _review(bool approve) async {
    setState(() => _busy = true);
    try {
      await reviewDriverDocument(ref, widget.driverId, widget.document!.id, approve);
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _view() {
    showDialog<void>(
      context: context,
      builder: (_) => _DocumentViewer(driverId: widget.driverId, document: widget.document!),
    );
  }

  @override
  Widget build(BuildContext context) {
    final doc = widget.document;
    final label = DriverDocument(id: '', type: widget.type, status: 'PENDING', uploadedAt: DateTime.now()).typeLabel;

    if (doc == null) {
      return ListTile(
        contentPadding: EdgeInsets.zero,
        leading: Icon(Icons.upload_file, color: Theme.of(context).disabledColor),
        title: Text(label),
        subtitle: const Text('Not uploaded'),
      );
    }

    final colour = doc.isApproved
        ? Colors.green
        : doc.isRejected
        ? Colors.red
        : Colors.blue;

    return Column(
      children: [
        ListTile(
          contentPadding: EdgeInsets.zero,
          leading: Icon(
            doc.isApproved
                ? Icons.verified
                : doc.isRejected
                ? Icons.error_outline
                : Icons.hourglass_bottom,
            color: colour,
          ),
          title: Text(label),
          subtitle: Text(doc.statusLabel, style: TextStyle(color: colour)),
          trailing: TextButton(onPressed: _view, child: const Text('View')),
        ),
        // An approved document is write-once server-side, so the buttons go
        // away rather than offering something that will be refused.
        if (doc.isPending)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: _busy
                ? const Center(child: CircularProgressIndicator())
                : Row(
                    mainAxisAlignment: MainAxisAlignment.end,
                    children: [
                      TextButton(onPressed: () => _review(false), child: const Text('Reject')),
                      const SizedBox(width: 8),
                      FilledButton(onPressed: () => _review(true), child: const Text('Approve document')),
                    ],
                  ),
          ),
      ],
    );
  }
}

/// Shows the decrypted document.
///
/// Images render inline, which covers the normal case — a driver photographs
/// their licence. Anything else says so plainly rather than showing a broken
/// image: the app has no PDF renderer, and pretending otherwise would leave
/// the office unable to tell "not an image" from "failed to load".
class _DocumentViewer extends ConsumerWidget {
  const _DocumentViewer({required this.driverId, required this.document});

  final String driverId;
  final DriverDocument document;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final bytes = ref.watch(
      driverDocumentFileProvider((driverId: driverId, documentId: document.id)),
    );

    return Dialog(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              children: [
                Expanded(child: Text(document.typeLabel, style: Theme.of(context).textTheme.titleMedium)),
                IconButton(icon: const Icon(Icons.close), onPressed: () => Navigator.pop(context)),
              ],
            ),
            const SizedBox(height: 8),
            Flexible(
              child: switch (bytes) {
                AsyncLoading() => const Padding(
                  padding: EdgeInsets.all(32),
                  child: CircularProgressIndicator(),
                ),
                AsyncError(:final error) => Padding(
                  padding: const EdgeInsets.all(16),
                  child: Text('Could not open this document: $error'),
                ),
                AsyncData(:final value) => InteractiveViewer(
                  child: Image.memory(
                    value,
                    errorBuilder: (context, _, _) => const Padding(
                      padding: EdgeInsets.all(24),
                      child: Text(
                        'This file is not an image, so it cannot be shown here.\n'
                        'Ask the driver to upload a photo of the document instead.',
                        textAlign: TextAlign.center,
                      ),
                    ),
                  ),
                ),
              },
            ),
          ],
        ),
      ),
    );
  }
}
