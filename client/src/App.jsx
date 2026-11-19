import { Navigate, Route, Routes } from 'react-router-dom';
import Profile from './pages/Profile.jsx';
import Home from './pages/Home.jsx';
import HostStub from './pages/HostStub.jsx';
import JoinStub from './pages/JoinStub.jsx';
import RemoteHome from './pages/RemoteHome.jsx';
import {displayRole} from './lib/displayRole.js';

export default function App() {
  const remote = displayRole(navigator) === 'remote';
  return (
    <Routes>
      <Route path="/profile" element={<Profile />} />
      <Route path="/" element={remote ? <RemoteHome /> : <Home />} />
      <Route path="/home" element={remote ? <RemoteHome /> : <Home />} />
      <Route path="/host/:code" element={<HostStub />} />
      <Route path="/join" element={<JoinStub />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
