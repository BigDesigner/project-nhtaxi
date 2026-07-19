import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// GNN LLC dispatch. Shown wherever a passenger might be stuck waiting, so
/// there's always a human fallback when the app can't help.
const adminPhoneNumber = '+1 603-348-5234';

class HelpCard extends StatelessWidget {
  const HelpCard({super.key});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: ListTile(
        leading: const Icon(Icons.support_agent),
        title: const Text('Having trouble?'),
        subtitle: const Text('Call us at $adminPhoneNumber'),
        trailing: IconButton(
          tooltip: 'Copy number',
          icon: const Icon(Icons.copy, size: 20),
          onPressed: () async {
            await Clipboard.setData(const ClipboardData(text: adminPhoneNumber));
            if (context.mounted) {
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('Phone number copied')),
              );
            }
          },
        ),
      ),
    );
  }
}
