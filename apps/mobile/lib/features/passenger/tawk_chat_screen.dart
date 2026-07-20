import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../../widgets/app_back_button.dart';

/// The direct link Tawk.to gives for this business's widget. Loaded in a
/// WebView rather than embedding their `<script>` snippet — that snippet
/// assumes an HTML host page with a `<head>`/`<body>` to inject into, which
/// a native Flutter screen doesn't have. A WebView pointed straight at the
/// chat page gets the same live chat with no script-injection plumbing.
const _tawkChatUrl = 'https://tawk.to/chat/68914f1388d9b3192aa858b4/1j1rppp3d';

/// Opens live chat only when tapped — never loaded eagerly on every screen,
/// which is what the embed script would otherwise do.
Future<void> openTawkChat(BuildContext context) async {
  // webview_flutter has no web-platform implementation at all; the flutter
  // web preview build (L32) opens the same link in a real browser tab
  // instead of trying to embed one WebView inside another.
  if (kIsWeb) {
    await launchUrl(Uri.parse(_tawkChatUrl), mode: LaunchMode.externalApplication);
    return;
  }
  await Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const TawkChatScreen()));
}

class TawkChatScreen extends StatefulWidget {
  const TawkChatScreen({super.key});

  @override
  State<TawkChatScreen> createState() => _TawkChatScreenState();
}

class _TawkChatScreenState extends State<TawkChatScreen> {
  late final WebViewController _controller;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setNavigationDelegate(
        NavigationDelegate(onPageFinished: (_) => setState(() => _loading = false)),
      )
      ..loadRequest(Uri.parse(_tawkChatUrl));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Chat with us'), leading: const AppBackButton()),
      body: Stack(
        children: [
          WebViewWidget(controller: _controller),
          if (_loading) const Center(child: CircularProgressIndicator()),
        ],
      ),
    );
  }
}
