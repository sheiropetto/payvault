import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ClerkProvider, useUser } from '@clerk/clerk-react';
import App from './App';
import ErrorBoundary from './components/ui/ErrorBoundary';
import { setUserEmail } from './utils/api';
import './index.css';

const CLERK_PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

// Bridge Clerk user email to api.js
function AuthBridge({ children }) {
  const { user } = useUser();
  React.useEffect(() => {
    setUserEmail(user?.primaryEmailAddress?.emailAddress || '');
  }, [user]);
  return children;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY}>
      <BrowserRouter>
        <AuthBridge>
          <ErrorBoundary>
            <App />
          </ErrorBoundary>
        </AuthBridge>
      </BrowserRouter>
    </ClerkProvider>
  </React.StrictMode>
);
