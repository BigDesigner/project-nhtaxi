import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:nhtaxi/core/location_socket.dart';

/// An in-memory stand-in for a real WebSocket, so these tests never touch a
/// network. `deliver` simulates the server pushing a frame; `dropConnection`
/// simulates the server (or the network) closing it out from under the app.
class _FakeTransport implements LocationTransport {
  final List<String> sent = [];
  final _incoming = StreamController<dynamic>.broadcast();
  bool closed = false;

  @override
  Stream<dynamic> get stream => _incoming.stream;

  @override
  void send(String data) => sent.add(data);

  @override
  Future<void> close() async {
    closed = true;
    await _incoming.close();
  }

  void deliver(String raw) => _incoming.add(raw);
  void dropConnection() => _incoming.close();
}

void main() {
  group('LocationSocket', () {
    test('decodes JSON frames onto the messages stream', () async {
      late _FakeTransport transport;
      final socket = LocationSocket(() async {
        transport = _FakeTransport();
        return transport;
      });

      final received = <Map<String, dynamic>>[];
      final sub = socket.messages.listen(received.add);

      await socket.connect();
      transport.deliver('{"type":"DRIVER_LOCATION","driverId":"d1","lat":44.05,"lng":-71.12}');
      await Future<void>.delayed(Duration.zero);

      expect(received, hasLength(1));
      expect(received.first['driverId'], 'd1');
      await sub.cancel();
    });

    test('ignores a frame that is not JSON, rather than crashing the stream', () async {
      late _FakeTransport transport;
      final socket = LocationSocket(() async {
        transport = _FakeTransport();
        return transport;
      });
      final received = <Map<String, dynamic>>[];
      final sub = socket.messages.listen(received.add);

      await socket.connect();
      transport.deliver('not json');
      transport.deliver('{"type":"PONG"}');
      await Future<void>.delayed(Duration.zero);

      // The garbage frame is dropped silently; a well-formed one right after
      // still comes through, proving the stream itself survived.
      expect(received, hasLength(1));
      expect(received.first['type'], 'PONG');
      await sub.cancel();
    });

    test('send() connects first if nothing is connected yet', () async {
      _FakeTransport? transport;
      final socket = LocationSocket(() async => transport = _FakeTransport());

      await socket.send({'type': 'LOCATION_UPDATE', 'lat': 44.0, 'lng': -71.0});

      expect(transport, isNotNull);
      expect(transport!.sent, hasLength(1));
      expect(transport!.sent.single, contains('LOCATION_UPDATE'));
    });

    test('reuses one connection across repeated connect()/send() calls', () async {
      var opens = 0;
      final socket = LocationSocket(() async {
        opens++;
        return _FakeTransport();
      });

      await socket.connect();
      await socket.connect();
      await socket.send({'type': 'PING'});

      expect(opens, 1);
    });

    test('reconnects after the connection drops unexpectedly', () async {
      final transports = <_FakeTransport>[];
      final socket = LocationSocket(
        () async {
          final t = _FakeTransport();
          transports.add(t);
          return t;
        },
        reconnectDelay: const Duration(milliseconds: 5),
      );

      await socket.connect();
      expect(transports, hasLength(1));

      transports.first.dropConnection();
      await Future<void>.delayed(const Duration(milliseconds: 30));

      // A second, independent transport was opened without anyone calling
      // connect() again — that's the whole point of reconnect-on-drop.
      expect(transports, hasLength(2));
    });

    test('does not reconnect once disconnect() has been called', () async {
      final transports = <_FakeTransport>[];
      final socket = LocationSocket(
        () async {
          final t = _FakeTransport();
          transports.add(t);
          return t;
        },
        reconnectDelay: const Duration(milliseconds: 5),
      );

      await socket.connect();
      socket.disconnect();
      transports.first.dropConnection();
      await Future<void>.delayed(const Duration(milliseconds: 30));

      // disconnect() means the session this socket was authenticated for is
      // over — resurrecting the connection on its own would be a bug, not a
      // resilience feature.
      expect(transports, hasLength(1));
      expect(transports.first.closed, isTrue);
    });
  });
}
