import 'dart:async';
import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

import 'config.dart';
import 'providers.dart';
import 'token_store.dart';

/// One end of the wire, abstracted so a test can hand [LocationSocket] an
/// in-memory pair instead of a real network socket. Production always uses
/// [_RealTransport]; nothing in [LocationSocket] itself knows or cares.
abstract class LocationTransport {
  Stream<dynamic> get stream;
  void send(String data);
  Future<void> close();
}

class _RealTransport implements LocationTransport {
  _RealTransport(this._channel);

  final WebSocketChannel _channel;

  @override
  Stream<dynamic> get stream => _channel.stream;

  @override
  void send(String data) => _channel.sink.add(data);

  @override
  Future<void> close() async => _channel.sink.close();
}

typedef TransportOpener = Future<LocationTransport> Function();

Future<LocationTransport> _openRealTransport(TokenStore tokenStore) async {
  final token = await tokenStore.readAccessToken();
  if (token == null) {
    throw StateError('No signed-in session to open a location socket with');
  }
  // Mirrors the server's own rule for identifying a non-cookie client
  // (apps/api/src/lib/ws-auth.ts): the app always authenticates as
  // ios/android everywhere, including on Flutter Web, so it carries its
  // Bearer token as a `Sec-WebSocket-Protocol: auth.<token>` subprotocol —
  // an Upgrade request has no place to put a normal Authorization header.
  final base = Uri.parse(AppConfig.apiBaseUrl);
  final wsUri = base.replace(scheme: base.scheme == 'https' ? 'wss' : 'ws', path: '/api/ws');
  final channel = WebSocketChannel.connect(wsUri, protocols: ['auth.$token']);
  await channel.ready;
  return _RealTransport(channel);
}

/// One connection to LocationHub (apps/api/src/durable-objects/location-hub.ts)
/// per app session, shared by whichever role needs it — a driver sends
/// LOCATION_UPDATE while online, a passenger or admin listens for
/// DRIVER_LOCATION. A single shared connection means a screen that wants to
/// watch driver movement never has to think about connecting, reconnecting,
/// or whether someone else already opened one.
///
/// Reconnects on an unexpected drop as long as the session is still live;
/// [disconnect] is the only thing that stops that — call it on logout, since
/// an authenticated socket must not outlive the session it was opened for.
class LocationSocket {
  LocationSocket(this._opener, {this.reconnectDelay = const Duration(seconds: 3)});

  final TransportOpener _opener;

  /// How long to wait before trying again after an unexpected drop.
  /// Overridable so tests don't have to wait out a real 3 seconds.
  final Duration reconnectDelay;

  LocationTransport? _transport;
  StreamSubscription<dynamic>? _sub;
  final _messages = StreamController<Map<String, dynamic>>.broadcast();
  Timer? _reconnectTimer;
  bool _closed = false;

  Stream<Map<String, dynamic>> get messages => _messages.stream;

  /// Opens the connection so [messages] starts producing events. Idempotent
  /// and safe to call from every screen that wants to watch driver movement —
  /// the second caller just finds it already connecting or connected.
  Future<void> connect() => _ensureConnected();

  /// Sends a message, connecting first if there isn't one yet. Used by the
  /// driver's location broadcaster.
  Future<void> send(Map<String, dynamic> message) async {
    await _ensureConnected();
    _transport?.send(jsonEncode(message));
  }

  Future<void> _ensureConnected() async {
    if (_closed || _transport != null) return;
    try {
      final transport = await _opener();
      if (_closed) {
        // disconnect() ran while we were mid-connect; don't leak the socket.
        await transport.close();
        return;
      }
      _transport = transport;
      _sub = transport.stream.listen(_onData, onDone: _onDisconnected, onError: (_) => _onDisconnected());
    } catch (_) {
      _scheduleReconnect();
    }
  }

  void _onData(dynamic raw) {
    if (raw is! String) return;
    try {
      final decoded = jsonDecode(raw);
      if (decoded is Map<String, dynamic>) _messages.add(decoded);
    } catch (_) {
      // Not JSON we understand — drop it rather than crash the stream over a
      // stray PONG-style frame or anything else the wire format grows later.
    }
  }

  void _onDisconnected() {
    unawaited(_sub?.cancel());
    _sub = null;
    _transport = null;
    if (!_closed) _scheduleReconnect();
  }

  void _scheduleReconnect() {
    if (_closed) return;
    _reconnectTimer?.cancel();
    _reconnectTimer = Timer(reconnectDelay, () {
      if (!_closed) unawaited(_ensureConnected());
    });
  }

  /// Tears the connection down for good — the session it was authenticated
  /// for is over.
  void disconnect() {
    _closed = true;
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
    unawaited(_sub?.cancel());
    _sub = null;
    unawaited(_transport?.close());
    _transport = null;
  }
}

final locationSocketProvider = Provider<LocationSocket>((ref) {
  final socket = LocationSocket(() => _openRealTransport(ref.read(tokenStoreProvider)));
  ref.onDispose(socket.disconnect);
  return socket;
});
