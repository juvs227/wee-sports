import {SPORTS} from '../lib/sports.js';
import {SportIcon} from './icons.jsx';

/** The same sport silhouettes on the phone and native controller. */
export function SelectedSportIcon({sport, ...props}) {
  const Icon = SPORTS.find(value => value.id === sport)?.Icon ?? SportIcon;
  return <Icon {...props} />;
}
