import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/geocoding.dart';
import '../../../core/providers.dart';
import '../../../widgets/error_banner.dart';

/// Address autocomplete backed by Nominatim.
///
/// Every keystroke is debounced — Nominatim's usage policy allows roughly one
/// request per second and searching per character would breach it outright.
class AddressSearchSheet extends ConsumerStatefulWidget {
  const AddressSearchSheet({super.key, required this.title});

  final String title;

  @override
  ConsumerState<AddressSearchSheet> createState() => _AddressSearchSheetState();
}

class _AddressSearchSheetState extends ConsumerState<AddressSearchSheet> {
  final _controller = TextEditingController();
  Timer? _debounce;
  List<GeoPlace> _results = const [];
  bool _loading = false;
  String? _error;

  @override
  void dispose() {
    _debounce?.cancel();
    _controller.dispose();
    super.dispose();
  }

  void _onChanged(String value) {
    _debounce?.cancel();
    if (value.trim().length < 3) {
      setState(() {
        _results = const [];
        _loading = false;
      });
      return;
    }
    setState(() => _loading = true);
    _debounce = Timer(GeocodingService.searchDebounce, () => _search(value));
  }

  Future<void> _search(String query) async {
    try {
      final results = await ref.read(geocodingProvider).search(query);
      if (!mounted) return;
      setState(() {
        _results = results;
        _loading = false;
        _error = null;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = 'Address lookup failed. Check your connection and try again.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: DraggableScrollableSheet(
        initialChildSize: 0.85,
        expand: false,
        builder: (context, scrollController) => Column(
          children: [
            Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: [
                  Expanded(child: Text(widget.title, style: Theme.of(context).textTheme.titleLarge)),
                  IconButton(icon: const Icon(Icons.close), onPressed: () => Navigator.of(context).pop()),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: TextField(
                controller: _controller,
                autofocus: true,
                decoration: InputDecoration(
                  hintText: 'Search for an address',
                  border: const OutlineInputBorder(),
                  prefixIcon: const Icon(Icons.search),
                  suffixIcon: _loading
                      ? const Padding(
                          padding: EdgeInsets.all(12),
                          child: SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)),
                        )
                      : null,
                ),
                onChanged: _onChanged,
              ),
            ),
            if (_error != null)
              Padding(padding: const EdgeInsets.all(16), child: ErrorBanner(message: _error!)),
            Expanded(
              child: ListView.builder(
                controller: scrollController,
                itemCount: _results.length,
                itemBuilder: (context, i) {
                  final place = _results[i];
                  return ListTile(
                    leading: const Icon(Icons.place_outlined),
                    title: Text(place.shortName),
                    subtitle: Text(
                      place.displayName,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                    onTap: () => Navigator.of(context).pop(place),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}
