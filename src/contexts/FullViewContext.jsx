import { createContext, useContext, useState } from 'react';

const FullViewContext = createContext({
  fullView: false,
  setFullView: () => {},
  sidebarCollapsed: false,
  toggleSidebar: () => {},
});

export function FullViewProvider({ children }) {
  const [fullView, setFullView] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const toggleSidebar = () => setSidebarCollapsed(prev => !prev);

  return (
    <FullViewContext.Provider value={{ fullView, setFullView, sidebarCollapsed, toggleSidebar }}>
      {children}
    </FullViewContext.Provider>
  );
}

export function useFullView() {
  return useContext(FullViewContext);
}
