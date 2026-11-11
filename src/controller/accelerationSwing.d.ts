export declare const classifierVersion: string;
export declare const SWING_LIMITS: Readonly<{ start: number }>;

export interface SwingResult {
  label: string;
  complete: boolean;
  peakRotation: number;
  startMs: number;
  peakTimeMs: number;
}

export interface SwingSample {
  timeMs: number;
  accelMag: number;
}

export interface SwingDetector {
  push(sample: SwingSample): SwingResult | null;
}

export declare function createSwingDetector(): SwingDetector;
