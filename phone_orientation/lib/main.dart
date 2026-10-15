import 'dart:async';
import 'package:flutter/material.dart';
import 'package:sensors_plus/sensors_plus.dart';

void main() {
  runApp(const MaterialApp(home: OrientationPage()));
}

class OrientationPage extends StatefulWidget {
  const OrientationPage({super.key});

  @override
  State<OrientationPage> createState() => _OrientationPageState();
}

class _OrientationPageState extends State<OrientationPage> {
  double x = 0;
  double y = 0;
  double z = 0;

  StreamSubscription<AccelerometerEvent>? subscription;

  @override
  void initState() {
    super.initState();

    subscription = accelerometerEventStream().listen((event) {
      setState(() {
        x = event.x;
        y = event.y;
        z = event.z;
      });
    });
  }

  @override
  void dispose() {
    subscription?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text("Phone Orientation")),
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text("X: ${x.toStringAsFixed(2)}"),
            Text("Y: ${y.toStringAsFixed(2)}"),
            Text("Z: ${z.toStringAsFixed(2)}"),
          ],
        ),
      ),
    );
  }
}
