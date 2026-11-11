export interface Diagnostics {
  enabled: boolean;
  count(name: string, amount?: number): void;
  observe(name: string, milliseconds: number): void;
  mark(id: string, stage: string, localTime?: number): void;
  measure(id: string, from: string, to: string, name: string): void;
  remote(name: string, report: unknown): void;
  snapshot(): unknown;
  clear(): void;
}
export const DIAGNOSTICS_PROBE: string;
export function createDiagnostics(options?: {enabled?: boolean; scope?: string; now?: () => number; capacity?: number}): Diagnostics;
export function browserDiagnostics(scope: string, target?: Window): Diagnostics;
export function nativeDiagnostics(scope: string, target?: typeof globalThis): Diagnostics;
