import { useRef, useState } from 'react';
import { useSignIn } from '@clerk/clerk-react';
import { useNavigate } from 'react-router-dom';
import { Vault, Mail, ArrowRight } from 'lucide-react';

export default function SignInPage() {
  const { signIn, isLoaded } = useSignIn();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState('email'); // email | code
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const codeRefs = useRef([]);

  const signInWithGoogle = () => {
    signIn.authenticateWithRedirect({
      strategy: 'oauth_google',
      redirectUrl: '/sso-callback',
      redirectUrlComplete: '/',
    });
  };

  const handleEmailSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const result = await signIn.create({
        strategy: 'email_code',
        identifier: email,
      });

      if (result.status === 'needs_second_factor') {
        setStage('code');
        // Focus first code input
        setTimeout(() => codeRefs.current[0]?.focus(), 100);
      } else {
        setStage('code');
        setTimeout(() => codeRefs.current[0]?.focus(), 100);
      }
    } catch (err) {
      setError(err.errors?.[0]?.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const handleCodeSubmit = async (e) => {
    e.preventDefault();
    if (code.length < 6) return;
    setLoading(true);
    setError('');

    try {
      const result = await signIn.attemptFirstFactor({
        strategy: 'email_code',
        code,
      });

      if (result.status === 'complete') {
        navigate('/');
      }
    } catch (err) {
      setError(err.errors?.[0]?.message || 'Invalid code');
      setCode('');
    } finally {
      setLoading(false);
    }
  };

  const handleCodeChange = (idx, val) => {
    if (val.length <= 1) {
      const newCode = code.split('');
      newCode[idx] = val;
      const joined = newCode.join('').slice(0, 6);
      setCode(joined);
      if (val && idx < 5) {
        codeRefs.current[idx + 1]?.focus();
      }
    }
  };

  const handleCodeKeyDown = (idx, e) => {
    if (e.key === 'Backspace' && !code[idx] && idx > 0) {
      codeRefs.current[idx - 1]?.focus();
    }
  };

  if (!isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50">
        <div className="w-6 h-6 border-2 border-zinc-300 border-t-zinc-900 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-zinc-900 mb-4">
            <Vault className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-lg font-semibold text-zinc-900">PayVault</h1>
          <p className="text-sm text-zinc-500 mt-1">Payment Voucher Manager</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl border border-zinc-200 p-6 shadow-sm">
          {stage === 'email' ? (
            <>
              {/* Google sign-in */}
              <button
                type="button"
                onClick={signInWithGoogle}
                className="w-full flex items-center justify-center gap-3 px-4 py-2.5
                  border border-zinc-300 rounded-lg text-sm font-medium text-zinc-700
                  hover:bg-zinc-50 transition-colors mb-3"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                Continue with Google
              </button>

              <div className="relative mb-4">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-zinc-200" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-white px-2 text-zinc-400">or</span>
                </div>
              </div>

              <form onSubmit={handleEmailSubmit}>
              <div className="mb-4">
                <label className="label">Email address</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" strokeWidth={1.5} />
                  <input
                    type="email"
                    className="input pl-10"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoFocus
                  />
                </div>
              </div>

              {error && (
                <p className="text-xs text-red-600 mb-4">{error}</p>
              )}

              <button type="submit" className="btn-primary w-full" disabled={loading || !email}>
                {loading ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>
                    Continue <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>

              <p className="text-xs text-zinc-400 text-center mt-4">
                Sign in with your email — we'll send you a code
              </p>
            </form>
            </>
          ) : (
            <form onSubmit={handleCodeSubmit}>
              <div className="text-center mb-6">
                <p className="text-sm text-zinc-600 mb-1">Check your email</p>
                <p className="text-xs text-zinc-400">We sent a 6-digit code to {email}</p>
              </div>

              <div className="flex justify-center gap-2 mb-6">
                {[0, 1, 2, 3, 4, 5].map((idx) => (
                  <input
                    key={idx}
                    ref={(el) => (codeRefs.current[idx] = el)}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    className="w-10 h-12 text-center text-lg font-semibold rounded-lg border border-zinc-300
                      focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900"
                    value={code[idx] || ''}
                    onChange={(e) => handleCodeChange(idx, e.target.value)}
                    onKeyDown={(e) => handleCodeKeyDown(idx, e)}
                  />
                ))}
              </div>

              {error && (
                <p className="text-xs text-red-600 text-center mb-4">{error}</p>
              )}

              <button
                type="submit"
                className="btn-primary w-full"
                disabled={loading || code.length < 6}
              >
                {loading ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  'Verify'
                )}
              </button>

              <button
                type="button"
                className="btn-ghost w-full mt-2"
                onClick={() => { setStage('email'); setCode(''); setError(''); }}
              >
                Back
              </button>
            </form>
          )}
        </div>

        <p className="text-xs text-zinc-400 text-center mt-6">
          By continuing, you agree to PayVault's Terms of Service
        </p>
      </div>
    </div>
  );
}
