import { Navigate, Route, Routes } from 'react-router-dom';
import Home from './pages/Home.jsx';
import HostStub from './pages/HostStub.jsx';
import JoinStub from './pages/JoinStub.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/host/:code" element={<HostStub />} />
      <Route path="/join" element={<JoinStub />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
