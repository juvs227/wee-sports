import {Link} from 'react-router-dom';
import {IslandScenery} from '../components/IslandScenery.jsx';
import {MAIN_ISLAND} from '../lib/island.js';
import {useIslandMotion} from '../lib/useIslandMotion.js';
import './Island.css';

export default function IslandLanding() {
  const {enabled} = useIslandMotion();
  return <main className="island-screen island-landing" data-display-role="tv" data-motion={enabled}>
    <IslandScenery image={MAIN_ISLAND.landing} />
    <h1 className="island-landing__wordmark">Wee Sports</h1>
    <Link to="/home?view=island" className="island-landing__play">Play</Link>
  </main>;
}
