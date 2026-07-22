import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nhtaxi/widgets/car_marker.dart';

void main() {
  group('CarMarker', () {
    testWidgets('builds at any heading, including null, without throwing', (tester) async {
      for (final heading in <double?>[null, 0, 45, 90, 180, 270, 359.9]) {
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: Center(child: CarMarker(color: Colors.green, headingDegrees: heading)),
            ),
          ),
        );
        expect(find.byType(CarMarker), findsOneWidget);
        expect(find.byType(Image), findsOneWidget);
        expect(tester.takeException(), isNull);
      }
    });

    testWidgets('applies the heading as a rotation on the car, not the status pip', (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(body: Center(child: CarMarker(color: Colors.red, headingDegrees: 90))),
        ),
      );
      // The car image sits inside a Transform; the pip does not.
      final transform = tester.widget<Transform>(
        find.ancestor(of: find.byType(Image), matching: find.byType(Transform)),
      );
      expect(transform.transform.getRotation().entry(0, 0), closeTo(math.cos(math.pi / 2), 0.01));
    });
  });
}
