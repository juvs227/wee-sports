export type SwingLabel = 'Forehand' | 'Backhand';
export type SwingHand = 'Left' | 'Right';

export interface SwingEvent {
    type: 'swing';
    id: string;
    label: SwingLabel;
    hand: SwingHand;
    power?: number;
    player?: 1 | 2;
}

export interface SwingConnectionOptions {
    room: string;
    role: 'phone' | 'game';
    onSwing?: (event: SwingEvent) => void;
    onStatus?: (text: string) => void;
    onAck?: (event: { id?: string; ok?: boolean; error?: string; receivers?: number; roundTripMs?: number; timingScope?: 'game' | 'server' }) => void;
    onSent?: (event: SwingEvent) => void;
}

export interface SwingConnection {
    sendSwing(label: SwingLabel, hand: SwingHand, power?: number): boolean;
    close(): void;
}

export function connectSwings(
    options: SwingConnectionOptions
): SwingConnection;
