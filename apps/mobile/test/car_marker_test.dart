import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gnncab/widgets/car_marker.dart';

void main() {
  group('CarMarker', () {
    testWidgets('paints at any heading, including null, without throwing', (tester) async {
      for (final heading in <double?>[null, 0, 45, 90, 180, 270, 359.9]) {
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: Center(child: CarMarker(color: Colors.green, headingDegrees: heading)),
            ),
          ),
        );
        expect(find.byType(CarMarker), findsOneWidget);
        // A null heading must not blow up — it's the "no movement yet" case.
        expect(tester.takeException(), isNull);
      }
    });

    testWidgets('applies the heading as a rotation', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(body: Center(child: CarMarker(color: Colors.red, headingDegrees: 90))),
        ),
      );
      final transform = tester.widget<Transform>(
        find.descendant(of: find.byType(CarMarker), matching: find.byType(Transform)),
      );
      // A 90° heading rotates the up-pointing car to face east — cos(90°) ≈ 0
      // in the rotation matrix, i.e. not the identity.
      expect(transform.transform.getRotation().entry(0, 0), closeTo(math.cos(math.pi / 2), 0.01));
    });
  });
}
