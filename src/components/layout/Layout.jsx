import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import { useFullView } from '../../contexts/FullViewContext';

export default function Layout() {
  const { fullView } = useFullView();

  return (
    <div className="flex min-h-screen">
      {!fullView && <Sidebar />}
      <main className={`flex-1 transition-all duration-200 ${fullView ? 'ml-0 p-3' : 'ml-56 p-6 lg:p-8'}`}>
        <Outlet />
      </main>
    </div>
  );
}
