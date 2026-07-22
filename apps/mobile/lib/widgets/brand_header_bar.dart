import 'package:flutter/material.dart';

import 'brand_logo.dart';

/// The app bar every shell (passenger/driver/admin) uses on every tab — a
/// centered, full-size wordmark instead of a corner-sized one, so the brand
/// reads the same regardless of which tab is open. [subtitle] names the
/// current tab underneath it, since the logo alone doesn't say "Balance" vs
/// "Profile".
class BrandHeaderBar extends StatelessWidget implements PreferredSizeWidget {
  const BrandHeaderBar({super.key, this.subtitle, this.actions});

  final String? subtitle;
  final List<Widget>? actions;

  @override
  Widget build(BuildContext context) {
    return AppBar(
      centerTitle: true,
      toolbarHeight: preferredSize.height,
      title: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        mainAxisSize: MainAxisSize.min,
        children: [
          const BrandLogo(height: 40),
          if (subtitle != null) ...[
            const SizedBox(height: 2),
            Text(subtitle!, style: Theme.of(context).textTheme.labelLarge),
          ],
        ],
      ),
      actions: actions,
    );
  }

  @override
  Size get preferredSize => const Size.fromHeight(kToolbarHeight + 16);
}
