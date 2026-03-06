import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Chat from './pages/Chat';
import Tasks from './pages/Tasks';
import Plugins from './pages/Plugins';
import Logs from './pages/Logs';
import StatusBoard from './pages/StatusBoard';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/chat" element={<Chat />} />
        <Route path="/tasks" element={<Tasks />} />
        <Route path="/plugins" element={<Plugins />} />
        <Route path="/logs" element={<Logs />} />
        <Route path="/status" element={<StatusBoard />} />
      </Route>
    </Routes>
  );
}
