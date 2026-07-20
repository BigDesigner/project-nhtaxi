import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/admin.dart';
import '../../widgets/app_back_button.dart';
import '../../widgets/error_banner.dart';
import 'admin_controllers.dart';

/// The audit trail.
///
/// Every money- or status-changing action has been writing one of these since
/// the first phase — commission flags, driver approvals, cash collections,
/// pricing changes, password changes — and none of it could be read. A record
/// nobody can look at is no use in the one situation it exists for, which is
/// a dispute months later.
class AdminAuditScreen extends ConsumerStatefulWidget {
  const AdminAuditScreen({super.key});

  @override
  ConsumerState<AdminAuditScreen> createState() => _AdminAuditScreenState();
}

class _AdminAuditScreenState extends ConsumerState<AdminAuditScreen> {
  bool _significantOnly = true;

  @override
  Widget build(BuildContext context) {
    final entries = ref.watch(auditLogProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Activity log'), leading: const AppBackButton()),
      body: Column(
        children: [
          SwitchListTile(
            value: _significantOnly,
            onChanged: (v) => setState(() => _significantOnly = v),
            title: const Text('Only money and approvals'),
            subtitle: const Text('Hides routine sign-ins and token refreshes'),
          ),
          const Divider(height: 1),
          Expanded(
            child: RefreshIndicator(
              onRefresh: () async {
                ref.invalidate(auditLogProvider);
                await ref.read(auditLogProvider.future);
              },
              child: switch (entries) {
                AsyncLoading() => const Center(child: CircularProgressIndicator()),
                AsyncError(:final error) => ListView(
                  padding: const EdgeInsets.all(16),
                  children: [ErrorBanner(message: error.toString())],
                ),
                AsyncData(:final value) => _Entries(
                  entries: _significantOnly ? value.where((e) => e.isSignificant).toList() : value,
                ),
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _Entries extends StatelessWidget {
  const _Entries({required this.entries});

  final List<AuditEntry> entries;

  @override
  Widget build(BuildContext context) {
    if (entries.isEmpty) {
      return ListView(
        children: const [
          Padding(padding: EdgeInsets.all(32), child: Center(child: Text('Nothing recorded yet.'))),
        ],
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: entries.length,
      itemBuilder: (context, i) {
        final e = entries[i];
        return Card(
          margin: const EdgeInsets.only(bottom: 8),
          child: ExpansionTile(
            leading: Icon(
              e.isSignificant ? Icons.gavel : Icons.schedule,
              color: e.isSignificant ? Theme.of(context).colorScheme.primary : Theme.of(context).disabledColor,
            ),
            title: Text(e.actionLabel),
            subtitle: Text(
              '${e.entity}${e.actorRole == null ? '' : ' · by ${e.actorRole}'} · ${_formatDate(e.createdAt)}',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (e.entityId != null) _Detail(label: 'Record', value: e.entityId!),
                    if (e.actorId != null) _Detail(label: 'Actor', value: e.actorId!),
                    if (e.ipAddress != null) _Detail(label: 'IP', value: e.ipAddress!),
                    // Metadata is where the substance lives — the old and new
                    // commission flag, the amount collected, the reason a
                    // session was force-closed.
                    if (e.metadata != null && e.metadata!.isNotEmpty)
                      for (final entry in e.metadata!.entries)
                        _Detail(label: entry.key, value: '${entry.value}'),
                  ],
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  String _formatDate(DateTime dt) {
    final d = dt.toLocal();
    return '${d.day.toString().padLeft(2, '0')}.${d.month.toString().padLeft(2, '0')}.${d.year} '
        '${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
  }
}

class _Detail extends StatelessWidget {
  const _Detail({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 120,
            child: Text(label, style: Theme.of(context).textTheme.bodySmall),
          ),
          Expanded(child: Text(value, style: Theme.of(context).textTheme.bodySmall)),
        ],
      ),
    );
  }
}
