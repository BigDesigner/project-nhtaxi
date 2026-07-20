import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../legal/terms.dart';
import '../../legal/terms_gate.dart';
import '../../widgets/app_back_button.dart';
import '../../widgets/error_banner.dart';
import 'auth_controller.dart';

/// Driver sign-up.
///
/// Vehicle fields are on this form rather than buried in settings, because
/// they're what a passenger uses to find the right car — but none of them are
/// required. A driver standing in a car park with one bar of signal should be
/// able to get an account and start; the home tab nags for anything missing.
class DriverSignupScreen extends ConsumerStatefulWidget {
  const DriverSignupScreen({super.key});

  @override
  ConsumerState<DriverSignupScreen> createState() => _DriverSignupScreenState();
}

class _DriverSignupScreenState extends ConsumerState<DriverSignupScreen> {
  final _formKey = GlobalKey<FormState>();
  final _firstName = TextEditingController();
  final _lastName = TextEditingController();
  final _email = TextEditingController();
  final _phone = TextEditingController();
  final _password = TextEditingController();
  final _make = TextEditingController();
  final _model = TextEditingController();
  final _colour = TextEditingController();
  final _plate = TextEditingController();
  final _year = TextEditingController();
  bool _agreed = false;

  @override
  void dispose() {
    for (final c in [_firstName, _lastName, _email, _phone, _password, _make, _model, _colour, _plate, _year]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    if (!_agreed) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please read and accept the Driver Agreement to continue.')),
      );
      return;
    }

    await ref.read(authControllerProvider.notifier).registerDriver(
          firstName: _firstName.text.trim(),
          lastName: _lastName.text.trim(),
          email: _email.text.trim(),
          phone: _phone.text.trim(),
          password: _password.text,
          vehicleMake: _make.text.trim(),
          vehicleModel: _model.text.trim(),
          vehicleColor: _colour.text.trim(),
          vehiclePlate: _plate.text.trim().toUpperCase(),
          vehicleYear: _year.text.trim().isEmpty ? null : int.tryParse(_year.text.trim()),
        );
    // The router's redirect takes it from here once auth state flips.
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authControllerProvider);
    final isBusy = auth.isLoading;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Drive with GNNcab'),
        leading: const AppBackButton(fallbackLocation: '/login'),
      ),
      body: SafeArea(
        child: Form(
          key: _formKey,
          child: ListView(
            padding: const EdgeInsets.all(24),
            children: [
              if (auth.hasError) ...[
                ErrorBanner(message: auth.error.toString()),
                const SizedBox(height: 16),
              ],
              _field(_firstName, 'First name', required: true),
              const SizedBox(height: 12),
              _field(_lastName, 'Last name', required: true),
              const SizedBox(height: 12),
              _field(
                _email,
                'Email',
                required: true,
                keyboard: TextInputType.emailAddress,
                validator: (v) => v!.contains('@') ? null : 'Enter a valid email',
              ),
              const SizedBox(height: 12),
              _field(_phone, 'Phone', required: true, keyboard: TextInputType.phone),
              const SizedBox(height: 12),
              _field(
                _password,
                'Password',
                required: true,
                obscure: true,
                validator: (v) => v!.length >= 8 ? null : 'At least 8 characters',
              ),
              const SizedBox(height: 24),
              Text('Your car', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 4),
              Text(
                'Optional now — you can add it later. Passengers use it to spot you '
                'at the kerb.',
                style: Theme.of(context).textTheme.bodySmall,
              ),
              const SizedBox(height: 12),
              _field(_make, 'Make (Toyota)'),
              const SizedBox(height: 12),
              _field(_model, 'Model (Sienna)'),
              const SizedBox(height: 12),
              _field(_colour, 'Colour (Silver)'),
              const SizedBox(height: 12),
              _field(_plate, 'Plate', capitals: true),
              const SizedBox(height: 12),
              _field(
                _year,
                'Year',
                keyboard: TextInputType.number,
                validator: (v) {
                  if (v == null || v.trim().isEmpty) return null;
                  final year = int.tryParse(v.trim());
                  if (year == null || year < 1980 || year > 2100) return 'Enter a year like 2019';
                  return null;
                },
              ),
              const SizedBox(height: 24),
              // Spells out the money side up front. A driver finding out about
              // the per-minute charge after their first invoice is a fight
              // nobody needs.
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('How you get paid', style: Theme.of(context).textTheme.titleSmall),
                      const SizedBox(height: 8),
                      Text(
                        'Passengers pay you in cash, directly. In return you pay GNN LLC for '
                        'the time you spend online in the app, and a share of the fare on jobs '
                        'the office assigns to you — that share is always shown before you '
                        'accept. You settle up in cash every couple of weeks, and the app '
                        'shows your running balance at all times.',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 8),
              TermsGate(
                document: driverTerms,
                accepted: _agreed,
                enabled: !isBusy,
                onChanged: (v) => setState(() => _agreed = v),
              ),
              const SizedBox(height: 16),
              FilledButton(
                onPressed: isBusy ? null : _submit,
                style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 16)),
                child: isBusy
                    ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Text('Create driver account'),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _field(
    TextEditingController controller,
    String label, {
    bool required = false,
    bool obscure = false,
    bool capitals = false,
    TextInputType? keyboard,
    String? Function(String?)? validator,
  }) {
    return TextFormField(
      controller: controller,
      obscureText: obscure,
      keyboardType: keyboard,
      textCapitalization: capitals ? TextCapitalization.characters : TextCapitalization.none,
      decoration: InputDecoration(labelText: label),
      validator: (v) {
        if (required && (v == null || v.trim().isEmpty)) return '$label is required';
        return validator?.call(v);
      },
    );
  }
}
