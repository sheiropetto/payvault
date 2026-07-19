import { Routes, Route, Navigate } from 'react-router-dom';
import { useUser, AuthenticateWithRedirectCallback } from '@clerk/clerk-react';
import { CompanyProvider } from './contexts/CompanyContext';
import { FullViewProvider } from './contexts/FullViewContext';
import Layout from './components/layout/Layout';
import SignInPage from './pages/SignInPage';
import Dashboard from './pages/Dashboard';
import BankStatements from './pages/BankStatements';
import Transactions from './pages/Transactions';
import Vouchers from './pages/Vouchers';
import Companies from './pages/Companies';
import Templates from './pages/Templates';
import Settings from './pages/Settings';
import Payees from './pages/Payees';

function ProtectedRoute({ children }) {
  const { isLoaded, isSignedIn } = useUser();

  if (!isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-zinc-300 border-t-zinc-900 rounded-full animate-spin" />
      </div>
    );
  }

  if (!isSignedIn) {
    return <Navigate to="/sign-in" replace />;
  }

  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/sign-in" element={<SignInPage />} />
      <Route
        path="/sso-callback"
        element={
          <AuthenticateWithRedirectCallback
            redirectUrlComplete="/"
            signInRedirectUrl="/"
          />
        }
      />
      <Route path="/" element={
        <ProtectedRoute>
          <CompanyProvider>
            <FullViewProvider>
              <Layout />
            </FullViewProvider>
          </CompanyProvider>
        </ProtectedRoute>
      }>
        <Route index element={<Dashboard />} />
        <Route path="bank-statements" element={<BankStatements />} />
        <Route path="transactions" element={<Transactions />} />
        <Route path="vouchers" element={<Vouchers />} />
        <Route path="companies" element={<Companies />} />
        <Route path="templates" element={<Templates />} />
        <Route path="settings" element={<Settings />} />
        <Route path="payees" element={<Payees />} />
      </Route>
    </Routes>
  );
}
