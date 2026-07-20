import 'package:flutter/material.dart';

import 'terms.dart';

/// The sign-up consent control.
///
/// The full text is behind a tap rather than inlined: a wall of legal copy
/// above a form gets scrolled past, and a checkbox next to text nobody opened
/// is worth nothing. Opening the document is therefore the only way to reach
/// the accept button — the checkbox on the form cannot be ticked directly.
class TermsGate extends StatelessWidget {
  const TermsGate({
    super.key,
    required this.document,
    required this.accepted,
    required this.onChanged,
    this.enabled = true,
  });

  final TermsDocument document;
  final bool accepted;
  final ValueChanged<bool> onChanged;
  final bool enabled;

  Future<void> _open(BuildContext context) async {
    final result = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => _TermsScreen(document: document)),
    );
    if (result != null) onChanged(result);
  }

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Checkbox(
              value: accepted,
              // Ticking is only possible by reading the document; unticking is
              // allowed directly, since withdrawing consent should never be
              // harder than giving it.
              onChanged: !enabled
                  ? null
                  : (value) {
                      if (value == true) {
                        _open(context);
                      } else {
                        onChanged(false);
                      }
                    },
            ),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(document.acceptLabel, style: Theme.of(context).textTheme.bodyMedium),
                  const SizedBox(height: 2),
                  TextButton(
                    onPressed: enabled ? () => _open(context) : null,
                    style: TextButton.styleFrom(
                      padding: EdgeInsets.zero,
                      minimumSize: const Size(0, 0),
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    ),
                    child: Text('Read the ${document.title}'),
                  ),
                ],
              ),
            ),
            if (accepted) const Icon(Icons.check_circle, color: Colors.green, size: 20),
          ],
        ),
      ),
    );
  }
}

class _TermsScreen extends StatefulWidget {
  const _TermsScreen({required this.document});

  final TermsDocument document;

  @override
  State<_TermsScreen> createState() => _TermsScreenState();
}

class _TermsScreenState extends State<_TermsScreen> {
  final _controller = ScrollController();
  bool _reachedEnd = false;

  @override
  void initState() {
    super.initState();
    _controller.addListener(_onScroll);
    // A document short enough not to scroll on a large screen would otherwise
    // never enable the button.
    WidgetsBinding.instance.addPostFrameCallback((_) => _onScroll());
  }

  @override
  void dispose() {
    _controller.removeListener(_onScroll);
    _controller.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (_reachedEnd || !_controller.hasClients) return;
    final position = _controller.position;
    // Accepting is only offered once the text has actually been scrolled
    // through. It isn't proof anyone read it, but it does rule out agreeing to
    // a document that was never even displayed.
    if (position.maxScrollExtent - position.pixels <= 24) {
      setState(() => _reachedEnd = true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final doc = widget.document;

    return Scaffold(
      appBar: AppBar(
        title: Text(doc.title),
        leading: IconButton(
          icon: const Icon(Icons.close),
          tooltip: 'Close without accepting',
          onPressed: () => Navigator.pop(context, false),
        ),
      ),
      body: Column(
        children: [
          Expanded(
            child: ListView(
              controller: _controller,
              padding: const EdgeInsets.all(24),
              children: [
                Text(doc.intro, style: Theme.of(context).textTheme.bodyMedium),
                const SizedBox(height: 8),
                Text(
                  'Version $termsVersion',
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                        color: Theme.of(context).hintColor,
                      ),
                ),
                const Divider(height: 32),
                for (final section in doc.sections) ...[
                  Text(section.heading, style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 6),
                  Text(section.body, style: Theme.of(context).textTheme.bodyMedium),
                  const SizedBox(height: 24),
                ],
              ],
            ),
          ),
          Material(
            elevation: 8,
            child: SafeArea(
              top: false,
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    if (!_reachedEnd)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: Text(
                          'Scroll to the end to continue.',
                          textAlign: TextAlign.center,
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                      ),
                    FilledButton(
                      onPressed: _reachedEnd ? () => Navigator.pop(context, true) : null,
                      style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 16)),
                      child: const Text('I accept'),
                    ),
                    TextButton(
                      onPressed: () => Navigator.pop(context, false),
                      child: const Text('Do not accept'),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
