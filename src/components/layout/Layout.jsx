import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import { useFullView } from '../../contexts/FullViewContext';

export default function Layout() {
  const { fullView, sidebarCollapsed, toggleSidebar } = useFullView();

  const mainMargin = fullView ? 'ml-0' : sidebarCollapsed ? 'ml-16' : 'ml-56';
  const mainPadding = fullView ? 'p-3' : 'p-6 lg:p-8';

  return (
    <div className="flex min-h-screen">
      {!fullView && (
        <Sidebar collapsed={sidebarCollapsed} onToggle={toggleSidebar} />
      )}
      <main className={`flex-1 transition-all duration-200 ${mainMargin} ${mainPadding}`}>
        <Outlet />
      </main>
    </div>
  );
}
