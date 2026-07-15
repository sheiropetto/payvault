import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../utils/api';

const CompanyContext = createContext();

export function CompanyProvider({ children }) {
  const [companies, setCompanies] = useState([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState(null);
  const [loading, setLoading] = useState(true);
  const hasAutoSelected = useRef(false);

  const loadCompanies = useCallback(async () => {
    try {
      const data = await api.getCompanies();
      setCompanies(data);
      // Auto-select first company only once
      if (data.length > 0 && !hasAutoSelected.current) {
        hasAutoSelected.current = true;
        setSelectedCompanyId(data[0].id);
      }
    } catch (err) {
      console.error('Failed to load companies:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCompanies();
  }, [loadCompanies]);

  const selectedCompany = companies.find(c => c.id === selectedCompanyId) || null;

  const switchCompany = (id) => {
    setSelectedCompanyId(id);
  };

  const refreshCompanies = async () => {
    setLoading(true);
    await loadCompanies();
  };

  return (
    <CompanyContext.Provider value={{
      companies,
      selectedCompany,
      selectedCompanyId,
      switchCompany,
      refreshCompanies,
      loading,
    }}>
      {children}
    </CompanyContext.Provider>
  );
}

export function useCompany() {
  const ctx = useContext(CompanyContext);
  if (!ctx) throw new Error('useCompany must be used within CompanyProvider');
  return ctx;
}
