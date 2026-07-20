import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../../models/admin.dart';
import '../../widgets/app_back_button.dart';
import '../../widgets/error_banner.dart';
import 'admin_controllers.dart';

/// Everyone with an account, and the only way to create another admin.
///
/// Bootstrap locks itself after the first admin, so without this screen a
/// second office account could only be made by editing the database. It is
/// also the only place an account can be switched off — deactivating leaves
/// the trip history intact for the books while login starts refusing.
class AdminPeopleScreen extends ConsumerWidget {
  const AdminPeopleScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final users = ref.watch(adminUsersProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('People'), leading: const AppBackButton()),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _showCreate(context, ref),
        icon: const Icon(Icons.person_add),
        label: const Text('Add'),
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(adminUsersProvider);
          await ref.read(adminUsersProvider.future);
        },
        child: switch (users) {
          AsyncLoading() => const Center(child: CircularProgressIndicator()),
          AsyncError(:final error) => ListView(
            padding: const EdgeInsets.all(16),
            children: [ErrorBanner(message: error.toString())],
          ),
          AsyncData(:final value) => _UserList(users: value),
        },
      ),
    );
  }

  Future<void> _showCreate(BuildContext context, WidgetRef ref) =>
      showDialog<void>(context: context, builder: (_) => const _CreateUserDialog());
}

class _UserList extends StatelessWidget {
  const _UserList({required this.users});

  final List<AdminUser> users;

  @override
  Widget build(BuildContext context) {
    if (users.isEmpty) {
      return ListView(
        children: const [Padding(padding: EdgeInsets.all(32), child: Center(child: Text('Nobody yet.')))],
      );
    }

    // Grouped by role rather than listed flat: the office looks for "who are
    // my admins" far more often than for one name.
    final byRole = <String, List<AdminUser>>{};
    for (final u in users) {
      byRole.putIfAbsent(u.role, () => []).add(u);
    }

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        for (final role in ['admin', 'driver', 'customer'])
          if (byRole[role] != null) ...[
            Text(
              '${_roleLabel(role)} (${byRole[role]!.length})',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            for (final u in byRole[role]!) _UserCard(user: u),
            const SizedBox(height: 16),
          ],
      ],
    );
  }

  String _roleLabel(String role) => switch (role) {
        'admin' => 'Office',
        'driver' => 'Drivers',
        'customer' => 'Passengers',
        _ => role,
      };
}

class _UserCard extends ConsumerStatefulWidget {
  const _UserCard({required this.user});

  final AdminUser user;

  @override
  ConsumerState<_UserCard> createState() => _UserCardState();
}

class _UserCardState extends ConsumerState<_UserCard> {
  bool _busy = false;

  Future<void> _setActive(bool active) async {
    final u = widget.user;

    if (!active) {
      final ok = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text('Deactivate ${u.fullName}?'),
          content: const Text(
            'They will not be able to sign in. Their trips and balances stay on '
            'record, and you can switch them back on at any time.',
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
            FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Deactivate')),
          ],
        ),
      );
      if (ok != true) return;
    }

    setState(() => _busy = true);
    try {
      await updateAdminUser(ref, u.id, isActive: active);
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final u = widget.user;

    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: u.isActive ? null : Theme.of(context).disabledColor.withValues(alpha: 0.2),
          child: Text(u.firstName.isNotEmpty ? u.firstName[0].toUpperCase() : '?'),
        ),
        title: Text(u.fullName),
        subtitle: Text(
          [u.email, if (!u.isActive) 'deactivated'].join(' · '),
          style: Theme.of(context).textTheme.bodySmall,
        ),
        trailing: _busy
            ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
            : TextButton(
                onPressed: () => _setActive(!u.isActive),
                child: Text(u.isActive ? 'Deactivate' : 'Reactivate'),
              ),
      ),
    );
  }
}

class _CreateUserDialog extends ConsumerStatefulWidget {
  const _CreateUserDialog();

  @override
  ConsumerState<_CreateUserDialog> createState() => _CreateUserDialogState();
}

class _CreateUserDialogState extends ConsumerState<_CreateUserDialog> {
  final _formKey = GlobalKey<FormState>();
  final _firstName = TextEditingController();
  final _lastName = TextEditingController();
  final _email = TextEditingController();
  final _phone = TextEditingController();
  final _password = TextEditingController();
  String _role = 'admin';
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    for (final c in [_firstName, _lastName, _email, _phone, _password]) {
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
      await createAdminUser(
        ref,
        firstName: _firstName.text.trim(),
        lastName: _lastName.text.trim(),
        email: _email.text.trim(),
        password: _password.text,
        role: _role,
        phone: _phone.text.trim().isEmpty ? null : _phone.text.trim(),
      );
      if (mounted) Navigator.pop(context);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Add someone'),
      content: SingleChildScrollView(
        child: Form(
          key: _formKey,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (_error != null) ...[
                Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                const SizedBox(height: 12),
              ],
              _field(_firstName, 'First name'),
              const SizedBox(height: 8),
              _field(_lastName, 'Last name'),
              const SizedBox(height: 8),
              _field(
                _email,
                'Email',
                validator: (v) => (v == null || !v.contains('@')) ? 'Enter a valid email' : null,
              ),
              const SizedBox(height: 8),
              _field(_phone, 'Phone (optional)', required: false),
              const SizedBox(height: 8),
              _field(
                _password,
                'Password',
                obscure: true,
                validator: (v) => (v == null || v.length < 8) ? 'At least 8 characters' : null,
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                initialValue: _role,
                decoration: const InputDecoration(labelText: 'Role'),
                items: const [
                  DropdownMenuItem(value: 'admin', child: Text('Office (admin)')),
                  DropdownMenuItem(value: 'driver', child: Text('Driver')),
                  DropdownMenuItem(value: 'customer', child: Text('Passenger')),
                ],
                onChanged: (v) => setState(() => _role = v ?? 'admin'),
              ),
              if (_role == 'driver') ...[
                const SizedBox(height: 8),
                Text(
                  'Created drivers still need approving, and still need to upload '
                  'their licence and background check.',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ],
            ],
          ),
        ),
      ),
      actions: [
        TextButton(onPressed: _saving ? null : () => Navigator.pop(context), child: const Text('Cancel')),
        FilledButton(
          onPressed: _saving ? null : _submit,
          child: _saving
              ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2))
              : const Text('Create'),
        ),
      ],
    );
  }

  Widget _field(
    TextEditingController controller,
    String label, {
    bool required = true,
    bool obscure = false,
    String? Function(String?)? validator,
  }) {
    return TextFormField(
      controller: controller,
      obscureText: obscure,
      decoration: InputDecoration(labelText: label),
      validator: (v) {
        if (required && (v == null || v.trim().isEmpty)) return 'Required';
        return validator?.call(v);
      },
    );
  }
}
