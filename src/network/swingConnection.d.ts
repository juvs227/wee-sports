export type SwingLabel = 'Forehand' | 'Backhand';
export type SwingHand = 'Left' | 'Right';

export interface SwingEvent {
    type: 'swing';
    id: string;
    label: SwingLabel;
    hand: SwingHand;
    aimX?: number;
    aimDepth?: number;
    power?: number;
}

export interface SwingConnectionOptions {
    room: string;
    role: 'phone' | 'game';
    onSwing?: (event: SwingEvent) => void;
    onStatus?: (text: string) => void;
    onAck?: (event: { receivers: number }) => void;
}

export interface SwingConnection {
    sendSwing(label: SwingLabel, hand: SwingHand, aimX?: number, aimDepth?: number, power?: number): boolean;
    close(): void;
}

export function connectSwings(
    options: SwingConnectionOptions
): SwingConnection;
