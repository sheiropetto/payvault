import { createContext, useContext, useState } from 'react';

const FullViewContext = createContext({
  fullView: false,
  setFullView: () => {},
});

export function FullViewProvider({ children }) {
  const [fullView, setFullView] = useState(false);
  return (
    <FullViewContext.Provider value={{ fullView, setFullView }}>
      {children}
    </FullViewContext.Provider>
  );
}

export function useFullView() {
  return useContext(FullViewContext);
}
