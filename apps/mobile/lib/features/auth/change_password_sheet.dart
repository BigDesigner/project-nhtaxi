import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../../core/providers.dart';

/// Change-password dialog, shared by all three roles.
///
/// Changing a password revokes every session, including other devices — that
/// is usually the whole reason someone is doing it. The server hands back a
/// fresh session for this device, which is saved here so the person isn't
/// signed out of the app they're standing in.
Future<void> showChangePasswordSheet(BuildContext context, WidgetRef ref) {
  return showDialog<void>(
    context: context,
    builder: (_) => const _ChangePasswordDialog(),
  );
}

class _ChangePasswordDialog extends ConsumerStatefulWidget {
  const _ChangePasswordDialog();

  @override
  ConsumerState<_ChangePasswordDialog> createState() => _ChangePasswordDialogState();
}

class _ChangePasswordDialogState extends ConsumerState<_ChangePasswordDialog> {
  final _formKey = GlobalKey<FormState>();
  final _current = TextEditingController();
  final _next = TextEditingController();
  final _confirm = TextEditingController();
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    for (final c in [_current, _next, _confirm]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final json = await ref.read(apiClientProvider).put(
        '/api/auth/password',
        body: {'currentPassword': _current.text, 'newPassword': _next.text},
      );

      // Every old token was just revoked server-side, so the one this device
      // is holding is dead. Save the replacement or the next request 401s.
      final accessToken = json['accessToken'] as String?;
      final refreshToken = json['refreshToken'] as String?;
      if (accessToken != null && refreshToken != null) {
        await ref.read(tokenStoreProvider).save(accessToken: accessToken, refreshToken: refreshToken);
      }

      if (!mounted) return;
      Navigator.pop(context);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Password changed. Other devices have been signed out.')),
      );
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Change password'),
      content: Form(
        key: _formKey,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (_error != null) ...[
              Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
              const SizedBox(height: 12),
            ],
            TextFormField(
              controller: _current,
              obscureText: true,
              autofocus: true,
              decoration: const InputDecoration(labelText: 'Current password'),
              validator: (v) => (v == null || v.isEmpty) ? 'Required' : null,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _next,
              obscureText: true,
              decoration: const InputDecoration(labelText: 'New password'),
              // Matches the API's minimum, so a too-short password is caught
              // before the round trip.
              validator: (v) => (v == null || v.length < 8) ? 'At least 8 characters' : null,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _confirm,
              obscureText: true,
              decoration: const InputDecoration(labelText: 'Confirm new password'),
              validator: (v) => v != _next.text ? 'The passwords do not match' : null,
            ),
            const SizedBox(height: 12),
            Text(
              'This signs you out everywhere else.',
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
        ),
      ),
      actions: [
        TextButton(onPressed: _saving ? null : () => Navigator.pop(context), child: const Text('Cancel')),
        FilledButton(
          onPressed: _saving ? null : _submit,
          child: _saving
              ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2))
              : const Text('Change'),
        ),
      ],
    );
  }
}
