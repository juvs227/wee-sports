import { ScanIcon, SwingIcon, TvIcon } from './icons.jsx';

const STEPS = [
  {
    Icon: TvIcon,
    title: 'Put it on the TV',
    text: 'Open Wee Sports on a laptop plugged into the TV and pick a sport.',
  },
  {
    Icon: ScanIcon,
    title: 'Scan to join',
    text: 'Everyone scans the QR code with their phone camera. No app to install.',
  },
  {
    Icon: SwingIcon,
    title: 'Swing',
    text: 'Calibrate your phone for motion or choose button controls. Watch the TV and play together.',
  },
];

export function HowItWorks() {
  return (
    <section id="how" className="how" aria-labelledby="how-title">
      <div className="section-head">
        <h2 id="how-title">How it works</h2>
        <p className="section-head__sub">From zero to playing in under two minutes.</p>
      </div>
      <ol className="how__steps">
        {STEPS.map(({ Icon, title, text }, index) => (
          <li key={title} className="how__step">
            <span className="how__num" aria-hidden="true">
              {index + 1}
            </span>
            <Icon className="how__icon" />
            <h3 className="how__title">{title}</h3>
            <p className="how__text">{text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
