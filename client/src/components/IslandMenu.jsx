import {useEffect, useId, useRef, useState} from 'react';
import {Link} from 'react-router-dom';
import {JoinBox} from './JoinBox.jsx';
import {ThemeToggle} from './ThemeToggle.jsx';
import {useIslandMotion} from '../lib/useIslandMotion.js';
import './IslandMenu.css';

function MenuIcon({kind}) {
  const paths = {
    menu: <><path d="M4 6h16M4 12h16M4 18h16" /></>,
    join: <><path d="M9 5H5v14h4M13 5h6v14h-6M2 12h12m-4-4 4 4-4 4" /></>,
    profile: <><circle cx="12" cy="8" r="3.5" /><path d="M5 21v-2a7 7 0 0 1 14 0v2" /></>,
    help: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1 .6-1.5 1-1.5 2m0 3h.01" /></>,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    back: <path d="m10 5-7 7 7 7M3 12h18" />,
  };
  return <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
    strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[kind]}</svg>;
}

/** Secondary island utilities. Native modal behavior keeps keyboard focus inside. */
export function IslandMenu() {
  const dialog = useRef(null);
  const trigger = useRef(null);
  const heading = useRef(null);
  const dialogId = useId();
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState('menu');
  const motion = useIslandMotion();

  function showMenu() {
    setPanel('menu');
    dialog.current.showModal();
    setOpen(true);
  }
  function closeMenu() { dialog.current.close(); }
  function closed() {
    setOpen(false);
    trigger.current?.focus({preventScroll: true});
  }
  useEffect(() => {
    if (!open) return;
    if (panel === 'join') dialog.current.querySelector('#join-code')?.focus({preventScroll: true});
    else heading.current?.focus({preventScroll: true});
  }, [open, panel]);
  useEffect(() => {
    const element = dialog.current;
    return () => { if (element.open) element.close(); };
  }, []);

  return <>
    <button ref={trigger} className="island-menu-trigger" type="button" onClick={showMenu}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={dialogId}>
      <MenuIcon kind="menu" /><span>Menu</span>
    </button>
    <dialog ref={dialog} id={dialogId} className="island-menu" aria-labelledby={titleId}
      onClose={closed} onClick={event => {
        if (event.target !== dialog.current) return;
        const bounds = dialog.current.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right ||
            event.clientY < bounds.top || event.clientY > bounds.bottom) closeMenu();
      }}>
      <div className="island-menu__header">
        {panel !== 'menu' && <button type="button" className="island-menu__icon-button" onClick={() => setPanel('menu')} aria-label="Back to menu"><MenuIcon kind="back" /></button>}
        <h2 id={titleId} ref={heading} tabIndex={-1}>{panel === 'join' ? 'Join a game' : panel === 'how' ? 'How to play' : 'Menu'}</h2>
        <button type="button" className="island-menu__icon-button" onClick={closeMenu} aria-label="Close menu"><MenuIcon kind="close" /></button>
      </div>
      {panel === 'menu' && <>
        <nav className="island-menu__links" aria-label="Island utilities">
          <button type="button" onClick={() => setPanel('join')}><MenuIcon kind="join" /><span>Join a game</span><span aria-hidden="true">›</span></button>
          <Link to="/profile" onClick={closeMenu}><MenuIcon kind="profile" /><span>Profile &amp; history</span><span aria-hidden="true">›</span></Link>
          <button type="button" onClick={() => setPanel('how')}><MenuIcon kind="help" /><span>How to play</span><span aria-hidden="true">›</span></button>
        </nav>
        <div className="island-menu__preferences">
          <div className="island-menu__preference"><span>Appearance</span><ThemeToggle /></div>
          <div className="island-menu__preference">
            <div><span>Motion</span><p id={`${dialogId}-motion`}>{motion.reducedMotion ? 'Reduced motion follows your device settings.' : 'Gentle water movement and screen transitions.'}</p></div>
            <button type="button" className="island-menu__switch" role="switch" aria-label="Motion"
              aria-checked={motion.preference && !motion.reducedMotion} aria-describedby={`${dialogId}-motion`}
              disabled={motion.reducedMotion} onClick={() => motion.setEnabled(!motion.preference)}>
              <span aria-hidden="true" />
            </button>
          </div>
        </div>
      </>}
      {panel === 'join' && <div className="island-menu__join"><JoinBox /></div>}
      {panel === 'how' && <ol className="island-menu__steps">
        <li><strong>Choose a sport on the TV</strong><p>Open Wee Sports on your laptop or TV and pick a game from the island.</p></li>
        <li><strong>Scan with your phone</strong><p>Use your camera to scan the room QR code. No account or app needed.</p></li>
        <li><strong>Tap Play and start moving</strong><p>Allow motion if your phone asks. Setup happens automatically, and touch controls are always available.</p></li>
      </ol>}
    </dialog>
  </>;
}
