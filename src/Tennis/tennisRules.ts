/** One court model for rendering, collision, service targets and prediction. */
export const TENNIS_COURT = {
    halfWidth: 4.115,
    halfLength: 11.885,
    serviceLine: 6.4,
    lineWidth: 0.05,
    netHalfWidth: 5.029,
    netCenterHeight: 0.914,
    netPostHeight: 1.07,
    netThickness: 0.04,
    serveDepth: 12.1,
    receiveDepth: 7.3,
    rallyDepth: 10,
} as const;
export type ServiceSide = 'deuce' | 'ad';
export type PointReason = 'out' | 'second-bounce' | 'net' | 'double-fault' | 'serve-volley';
export type ServeCall = 'first-fault' | 'let';

export function netHeightAt(x: number): number {
    const amount = Math.min(1, Math.abs(x) / TENNIS_COURT.netHalfWidth);
    return TENNIS_COURT.netCenterHeight +
        (TENNIS_COURT.netPostHeight - TENNIS_COURT.netCenterHeight) * amount * amount;
}
export function serviceSign(server: 1 | 2, side: ServiceSide): number {
    return (server === 1 ? 1 : -1) * (side === 'deuce' ? 1 : -1);
}
export function insideCourt(x: number, z: number, radius: number): boolean {
    // A ball touching a painted line is in; geometry uses outer court dimensions.
    return Math.abs(x) - radius <= TENNIS_COURT.halfWidth &&
        Math.abs(z) - radius <= TENNIS_COURT.halfLength;
}
export function insideServiceBox(x: number, z: number, server: 1 | 2,
    side: ServiceSide, radius: number): boolean {
    const direction = server === 1 ? -1 : 1;
    const targetSign = -serviceSign(server, side);
    return z * direction > 0 && z * direction - radius <= TENNIS_COURT.serviceLine &&
        x * targetSign + radius >= -TENNIS_COURT.lineWidth / 2 &&
        Math.abs(x) - radius <= TENNIS_COURT.halfWidth;
}
export function pointReasonLabel(reason: PointReason): string {
    return ({out: 'Out', 'second-bounce': 'Second bounce', net: 'Net',
        'double-fault': 'Double fault', 'serve-volley': 'Serve returned before its bounce'})[reason];
}
