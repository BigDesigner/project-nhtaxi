import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';

/// GNN LLC dispatch. Shown wherever a passenger might be stuck waiting, so
/// there's always a human fallback when the app can't help.
const adminPhoneNumber = '+1 603-348-5234';

/// tel: needs the bare number — spaces and dashes break the dialer.
const _dialableNumber = '+16033485234';

class HelpCard extends StatelessWidget {
  const HelpCard({super.key, this.title, this.message});

  /// Overrides for the places where the reason to call is specific — e.g. a
  /// trip that can no longer be cancelled in-app.
  final String? title;
  final String? message;

  Future<void> _call(BuildContext context) async {
    final uri = Uri(scheme: 'tel', path: _dialableNumber);
    final launched = await launchUrl(uri);
    // Desktop browsers usually have no dialer registered. Rather than fail
    // silently, hand over the number so it can be dialled by hand.
    if (!launched && context.mounted) {
      await Clipboard.setData(const ClipboardData(text: adminPhoneNumber));
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not open the dialler — number copied instead')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Card(
      child: ListTile(
        leading: const Icon(Icons.support_agent),
        title: Text(title ?? 'Having trouble?'),
        subtitle: Text(message ?? 'Tap to call us at $adminPhoneNumber'),
        trailing: const Icon(Icons.phone),
        onTap: () => _call(context),
      ),
    );
  }
}
