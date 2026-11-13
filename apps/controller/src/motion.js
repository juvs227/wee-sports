import { Accelerometer, DeviceMotion, Gyroscope } from 'expo-sensors';
import { MotionController } from './motionCore.js';

export class NativeMotionController extends MotionController {
  constructor(options) { super({ ...options, sensors: { Accelerometer, DeviceMotion, Gyroscope } }); }
}
