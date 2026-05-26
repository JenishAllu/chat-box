import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { useLocation, useNavigate } from 'react-router-dom';
import validateUsername, { normalizeUsername } from '../utils/usernameValidator';
import './Auth.css';

const runtimeConfig = window.__APP_CONFIG__ || {};
const API_BASE = runtimeConfig.REACT_APP_API_URL || process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:5000`;
const GOOGLE_CLIENT_ID = runtimeConfig.REACT_APP_GOOGLE_CLIENT_ID || process.env.REACT_APP_GOOGLE_CLIENT_ID || '';

function syncAuthHeader(token) {
  if (token) {
    axios.defaults.headers.common.Authorization = `Bearer ${token}`;
  } else {
    delete axios.defaults.headers.common.Authorization;
  }
}

function getResetTokenFromLocation(location) {
  const searchParams = new URLSearchParams(location.search || '');
  const directToken = searchParams.get('token');
  if (directToken) return directToken;

  const hash = window.location.hash || '';
  const queryIndex = hash.indexOf('?');
  if (queryIndex >= 0) {
    return new URLSearchParams(hash.slice(queryIndex + 1)).get('token') || '';
  }

  return '';
}

function getGoogleButtonWidth() {
  if (typeof window === 'undefined') return 260;
  return Math.max(220, Math.min(360, window.innerWidth - 48));
}

function Auth({ onAuthSuccess }) {
  const location = useLocation();
  const nav = useNavigate();
  const googleButtonRef = useRef(null);
  const isResetRoute = location.pathname === '/reset-password';
  const [mode, setMode] = useState(isResetRoute ? 'reset-password' : 'login');
  const [form, setForm] = useState({ username: '', realName: '', email: '', password: '' });
  const [resetForm, setResetForm] = useState({ password: '', confirmPassword: '' });
  const [otp, setOtp] = useState('');
  const [pendingEmail, setPendingEmail] = useState('');
  const [googleIdToken, setGoogleIdToken] = useState('');
  const [googleProfile, setGoogleProfile] = useState({ email: '', name: '', picture: '' });
  const [recoveryMethod, setRecoveryMethod] = useState('link');
  const [resetRecoveryEmail, setResetRecoveryEmail] = useState('');
  const [resetOtp, setResetOtp] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleReady, setGoogleReady] = useState(false);
  const [googleScriptLoaded, setGoogleScriptLoaded] = useState(false);
  const resetToken = useMemo(() => getResetTokenFromLocation(location), [location.search, location.pathname]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      syncAuthHeader(token);
    }

    try {
      const raw = localStorage.getItem('user');
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && parsed._id && token && !isResetRoute) {
        nav('/chat', { replace: true });
      }
    } catch {
      // Ignore malformed localStorage data.
    }
  }, [nav, isResetRoute]);

  useEffect(() => {
    if (isResetRoute) {
      setMode('reset-password');
      setRecoveryMethod('link');
      setResetRecoveryEmail('');
      setResetOtp('');
      setError('');
      setSuccess('');
    }
  }, [isResetRoute]);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return undefined;

    const scriptId = 'google-identity-services';
    const existing = document.getElementById(scriptId);
    let cancelled = false;
    let retryTimer = null;

    const initializeGoogle = () => {
      if (cancelled) return;
      if (!window.google?.accounts?.id || !googleButtonRef.current) {
        retryTimer = window.setTimeout(initializeGoogle, 50);
        return;
      }

      if (googleScriptLoaded) {
        try {
          window.google.accounts.id.cancel();
        } catch {
          // Ignore if cancel is not available.
        }
      }

      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async (response) => {
          if (!response?.credential) {
            setError('Google sign-in failed');
            return;
          }

          setError('');
          setSuccess('');
          setGoogleLoading(true);
          try {
            const res = await axios.post(`${API_BASE}/api/auth/google`, {
              idToken: response.credential,
            });

            if (res.data?.needsUsername) {
              const suggestedUsername = normalizeUsername((res.data.email || '').split('@')[0] || '');
              setGoogleIdToken(response.credential);
              setGoogleProfile({
                email: res.data.email || '',
                name: res.data.displayName || '',
                picture: res.data.picture || '',
              });
              setForm(prev => ({
                ...prev,
                username: suggestedUsername || prev.username,
                realName: res.data.displayName || prev.realName,
                email: res.data.email || prev.email,
              }));
              setMode('google-username');
              setSuccess('Choose a username to finish creating your account.');
              return;
            }

            if (res.data?.token) {
              localStorage.setItem('user', JSON.stringify(res.data.user));
              localStorage.setItem('token', res.data.token);
              syncAuthHeader(res.data.token);
              if (onAuthSuccess) onAuthSuccess();
              nav('/chat', { replace: true });
              return;
            }

            setError('Google sign-in did not return a session');
          } catch (err) {
            setError(err.response?.data?.msg || err.response?.data?.error || 'Google authentication failed');
          } finally {
            setGoogleLoading(false);
          }
        },
      });

      window.google.accounts.id.renderButton(googleButtonRef.current, {
        theme: 'outline',
        size: 'large',
        width: getGoogleButtonWidth(),
        text: 'continue_with',
        shape: 'rectangular',
      });

      setGoogleScriptLoaded(true);
      setGoogleReady(true);
    };

    if (existing) {
      initializeGoogle();
      return undefined;
    }

    const script = document.createElement('script');
    script.id = scriptId;
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = initializeGoogle;
    document.body.appendChild(script);

    return () => {
      cancelled = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      setGoogleReady(false);
    };
  }, [nav, onAuthSuccess]);

  useEffect(() => {
    if (!showGoogleAuth || !window.google?.accounts?.id || !googleButtonRef.current) return;

    try {
      window.google.accounts.id.renderButton(googleButtonRef.current, {
        theme: 'outline',
        size: 'large',
        width: getGoogleButtonWidth(),
        text: 'continue_with',
        shape: 'rectangular',
      });
      setGoogleReady(true);
    } catch {
      // The mount effect will retry if the container is still not ready.
    }
  }, [mode]);

  const submitLabel = useMemo(() => {
    if (mode === 'forgot-password') return loading ? 'Sending Reset Link...' : 'Send Reset Link';
    if (mode === 'reset-password') return loading ? 'Resetting Password...' : 'Reset Password';
    if (mode === 'verify') return 'Verify Email';
    if (mode === 'register') return loading ? 'Creating Account...' : 'Create Account';
    return loading ? 'Signing In...' : 'Login';
  }, [loading, mode]);

  const switchMode = (nextMode) => {
    setMode(nextMode);
    setError('');
    setSuccess('');
    setOtp('');
    if (nextMode !== 'reset-password') {
      setRecoveryMethod('link');
      setResetRecoveryEmail('');
      setResetOtp('');
    }
  };

  const returnToLogin = () => {
    setRecoveryMethod('link');
    setResetRecoveryEmail('');
    setResetOtp('');
    setResetForm({ password: '', confirmPassword: '' });
    setError('');
    setSuccess('');
    setMode('login');
    nav('/auth', { replace: true });
  };

  const submit = async (e) => {
    if (e) e.preventDefault();
    setError('');
    setSuccess('');

    if (mode === 'forgot-password') {
      if (!form.email.trim()) {
        setError('Email is required');
        return;
      }
    } else if (mode === 'reset-password') {
      if (recoveryMethod === 'otp') {
        if (!resetRecoveryEmail.trim() || !resetOtp.trim()) {
          setError('Email and OTP are required');
          return;
        }
      } else if (!resetToken) {
        setError('Reset link is missing a token');
        return;
      }
      if (!resetForm.password.trim() || !resetForm.confirmPassword.trim()) {
        setError('New password and confirmation are required');
        return;
      }
      if (resetForm.password !== resetForm.confirmPassword) {
        setError('Passwords do not match');
        return;
      }
      if (String(resetForm.password || '').length < 8) {
        setError('Password must be at least 8 characters long');
        return;
      }
    } else if (mode === 'verify') {
      if (!pendingEmail || !otp.trim()) {
        setError('Email and OTP are required');
        return;
      }
    } else if (mode === 'google-username') {
      if (!googleIdToken) {
        setError('Google sign-in needs to be started again');
        return;
      }
      if (!form.username.trim()) {
        setError('Username is required');
        return;
      }
      if (!form.password.trim() || !form.confirmPassword.trim()) {
        setError('Password and confirmation are required');
        return;
      }
      if (form.password !== form.confirmPassword) {
        setError('Passwords do not match');
        return;
      }
      if (String(form.password || '').length < 8) {
        setError('Password must be at least 8 characters long');
        return;
      }
    } else if (!form.email.trim() || !form.password.trim() || (mode === 'register' && (!form.username.trim() || !form.realName.trim()))) {
      setError('All fields are required');
      return;
    }

    if (mode === 'register' || mode === 'google-username') {
      const validation = validateUsername(form.username);
      if (!validation.valid) {
        setError(validation.message);
        return;
      }
    }

    setLoading(true);
    try {
      if (mode === 'forgot-password') {
        if (recoveryMethod === 'otp') {
          const res = await axios.post(`${API_BASE}/api/auth/forgot-password-otp`, {
            email: form.email.trim(),
          });
          setResetRecoveryEmail(form.email.trim().toLowerCase());
          setRecoveryMethod('otp');
          setMode('reset-password');
          setResetOtp('');
          setSuccess(res.data.msg || 'If the account exists, an OTP has been sent.');
          return;
        }
        const res = await axios.post(`${API_BASE}/api/auth/forgot-password`, {
          email: form.email.trim(),
        });
        setSuccess(res.data.msg || 'If the account exists, a reset link has been sent.');
        return;
      }

      if (mode === 'reset-password') {
        const payload = recoveryMethod === 'otp'
          ? {
              email: resetRecoveryEmail.trim(),
              otp: resetOtp.trim(),
              password: resetForm.password,
            }
          : {
              token: resetToken,
              password: resetForm.password,
            };

        const res = await axios.post(`${API_BASE}/api/auth/reset-password`, payload);
        setSuccess(res.data.msg || 'Password reset successfully. You can now log in.');
        setResetForm({ password: '', confirmPassword: '' });
        setResetOtp('');
        setResetRecoveryEmail('');
        setRecoveryMethod('link');
        nav('/auth', { replace: true });
        setMode('login');
        return;
      }

      if (mode === 'verify') {
        const res = await axios.post(`${API_BASE}/api/auth/verify-otp`, {
          email: pendingEmail,
          otp: otp.trim(),
        });
        setSuccess(res.data.msg || 'Email verified. You can now sign in.');
        setMode('login');
        setOtp('');
        setError('');
        setForm(prev => ({ ...prev, email: pendingEmail }));
        return;
      }

      if (mode === 'register') {
        const normalized = normalizeUsername(form.username);
        const res = await axios.post(`${API_BASE}/api/auth/register`, {
          username: normalized,
          email: form.email.trim(),
          password: form.password,
          realName: form.realName.trim(),
        });
        setPendingEmail(res.data.email || form.email.trim());
        setMode('verify');
        setOtp('');
        setSuccess(res.data.msg || 'Verification code sent to your email.');
        return;
      }

      if (mode === 'google-username') {
        const normalized = normalizeUsername(form.username);
        const res = await axios.post(`${API_BASE}/api/auth/google`, {
          idToken: googleIdToken,
          username: normalized,
          password: form.password,
        });

        localStorage.setItem('user', JSON.stringify(res.data.user));
        if (res.data.token) {
          localStorage.setItem('token', res.data.token);
          syncAuthHeader(res.data.token);
        }
        if (onAuthSuccess) {
          onAuthSuccess();
        }
        nav('/chat', { replace: true });
        return;
      }

      const res = await axios.post(`${API_BASE}/api/auth/login`, {
        email: form.email.trim(),
        password: form.password,
      });
      localStorage.setItem('user', JSON.stringify(res.data.user));
      if (res.data.token) {
        localStorage.setItem('token', res.data.token);
        syncAuthHeader(res.data.token);
      }
      if (onAuthSuccess) {
        onAuthSuccess();
      }
      nav('/chat', { replace: true });
    } catch (err) {
      const response = err.response?.data || {};
      // If backend indicates the account wasn't found, force logout and show login page
      if (response && (response.msg === 'Account not found' || err.response?.status === 404)) {
        try {
          localStorage.removeItem('token');
          localStorage.removeItem('user');
        } catch {}
        syncAuthHeader(null);
        setMode('login');
        nav('/auth', { replace: true });
        setError(response.msg || 'Account not found');
      } else if (response.pendingVerification) {
        setPendingEmail(response.email || form.email.trim());
        setMode('verify');
        setSuccess('Your account still needs email verification. Enter the OTP sent to your inbox.');
        setError('');
      } else {
        setError(response.msg || response.error || 'Authentication failed');
      }
    } finally {
      setLoading(false);
    }
  };

  const resendOtp = async () => {
    if (!pendingEmail) {
      setError('Please enter your email address first');
      return;
    }

    setResendLoading(true);
    setError('');
    setSuccess('');
    try {
      const res = await axios.post(`${API_BASE}/api/auth/resend-otp`, { email: pendingEmail });
      setSuccess(res.data.msg || 'Verification code resent.');
    } catch (err) {
      setError(err.response?.data?.msg || err.response?.data?.error || 'Failed to resend OTP');
    } finally {
      setResendLoading(false);
    }
  };

  const showRegisterFields = mode === 'register';
  const showVerifyFields = mode === 'verify';
  const showGoogleUsernameFields = mode === 'google-username';
  const showForgotFields = mode === 'forgot-password';
  const showResetFields = mode === 'reset-password';
  const showGoogleAuth = !showVerifyFields && !showForgotFields && !showResetFields && (mode === 'login' || mode === 'register');

  return (
    <div className="auth-page">
      <div className="auth-container">
        {/* Left Side: Brand Panel */}
        <div className="auth-side-panel">
          <div className="brand-logo">
            <span className="logo-icon">💬</span>
            <span>Insta Chat</span>
          </div>
          <div className="panel-content">
            <h1>Connect with the world in real-time.</h1>
            <p>Experience ultra-fast messaging, rich media sharing, secure group chats, and real-time custom statuses.</p>
            
            <div className="features-list">
              <div className="feature-item">
                <span className="feature-icon">⚡</span>
                <div>
                  <strong>Ultra-Fast Delivery</strong>
                  <span>Instant message transfers powered by Socket.io.</span>
                </div>
              </div>
              <div className="feature-item">
                <span className="feature-icon">🛡️</span>
                <div>
                  <strong>Robust Privacy</strong>
                  <span>Account security, trust levels, and user blocklists.</span>
                </div>
              </div>
              <div className="feature-item">
                <span className="feature-icon">✨</span>
                <div>
                  <strong>Rich Chat Features</strong>
                  <span>Direct replies, emoji support, forwarding, and editing.</span>
                </div>
              </div>
            </div>
          </div>
          <div className="panel-footer">
            <span>© 2026 Insta Chat. Secure Messaging & Realtime Delivery.</span>
          </div>
        </div>

        {/* Right Side: Form Panel */}
        <div className="auth-form-panel">
          <div className="auth-card">
            <div className="auth-header">
              <h2>
                {showResetFields
                  ? 'Reset Password'
                  : showVerifyFields
                  ? 'Verify Email'
                  : showGoogleUsernameFields
                    ? 'Choose a Username'
                    : showForgotFields
                      ? 'Forgot Password'
                    : mode === 'login'
                      ? 'Welcome Back'
                      : 'Create Account'}
              </h2>
              <p>
                {showResetFields
                  ? 'Set a new password for your account'
                  : showVerifyFields
                  ? 'Enter the one-time code we sent to your inbox'
                  : showGoogleUsernameFields
                    ? `Google account verified${googleProfile.email ? ` for ${googleProfile.email}` : ''}. Pick a username to finish.`
                    : showForgotFields
                      ? (recoveryMethod === 'otp'
                          ? 'Enter your email and we will send an OTP'
                          : 'Enter your email and we will send a reset link')
                  : mode === 'login'
                    ? 'Log in to continue your journey'
                    : 'Join us to get started with Insta Chat'}
              </p>
            </div>

            {error && <div className="auth-error">{error}</div>}
            {success && <div className="auth-success">{success}</div>}

            <form onSubmit={submit} className="auth-form">
              {showRegisterFields && (
                <>
                  <div className="input-group">
                    <input
                      type="text"
                      placeholder="Full Name"
                      value={form.realName}
                      onChange={e => setForm({ ...form, realName: e.target.value })}
                      autoComplete="name"
                    />
                  </div>
                  <div className="input-group">
                    <input
                      type="text"
                      placeholder="Username"
                      value={form.username}
                      onChange={e => setForm({ ...form, username: e.target.value })}
                      autoComplete="username"
                    />
                  </div>
                </>
              )}

              {showForgotFields && (
                <>
                  <div className="auth-step-note">
                    Choose how you want to recover your password.
                  </div>
                  <div className="auth-recovery-methods">
                    <button
                      type="button"
                      className={`auth-recovery-method ${recoveryMethod === 'link' ? 'active' : ''}`}
                      onClick={() => setRecoveryMethod('link')}
                    >
                      Reset link
                    </button>
                    <button
                      type="button"
                      className={`auth-recovery-method ${recoveryMethod === 'otp' ? 'active' : ''}`}
                      onClick={() => setRecoveryMethod('otp')}
                    >
                      OTP
                    </button>
                  </div>
                  <div className="auth-step-note">
                    {recoveryMethod === 'otp'
                      ? 'Enter the email address attached to your account and we will send a one-time code.'
                      : 'Enter the email address attached to your account and we will send a reset link.'}
                  </div>
                  <div className="input-group">
                    <input
                      type="email"
                      placeholder="Email"
                      value={form.email}
                      onChange={e => setForm({ ...form, email: e.target.value })}
                      autoComplete="email"
                    />
                  </div>
                </>
              )}

              {showResetFields && (
                <>
                  <div className="auth-step-note">
                    {recoveryMethod === 'otp'
                      ? 'Enter the OTP sent to your email and choose a new password.'
                      : (resetToken ? 'Reset link verified. Choose a new password.' : 'Reset link is missing or invalid.')}
                  </div>
                  {recoveryMethod === 'otp' && (
                    <div className="input-group">
                      <input
                        type="email"
                        placeholder="Email"
                        value={resetRecoveryEmail}
                        onChange={e => setResetRecoveryEmail(e.target.value)}
                        autoComplete="email"
                      />
                    </div>
                  )}
                  {recoveryMethod === 'otp' && (
                    <div className="input-group">
                      <input
                        type="text"
                        placeholder="6-digit OTP"
                        value={resetOtp}
                        onChange={e => setResetOtp(e.target.value)}
                        inputMode="numeric"
                        maxLength={6}
                        autoComplete="one-time-code"
                      />
                    </div>
                  )}
                  <div className="input-group">
                    <input
                      type="password"
                      placeholder="New password"
                      value={resetForm.password}
                      onChange={e => setResetForm({ ...resetForm, password: e.target.value })}
                      autoComplete="new-password"
                    />
                  </div>
                  <div className="input-group">
                    <input
                      type="password"
                      placeholder="Confirm new password"
                      value={resetForm.confirmPassword}
                      onChange={e => setResetForm({ ...resetForm, confirmPassword: e.target.value })}
                      autoComplete="new-password"
                    />
                  </div>
                </>
              )}

              {showGoogleUsernameFields && (
                <>
                  <div className="auth-step-note">
                    {googleProfile.name || 'Google sign-in'} is almost done. Choose your username to create the account.
                  </div>
                  <div className="input-group">
                    <input
                      type="text"
                      placeholder="Username"
                      value={form.username}
                      onChange={e => setForm({ ...form, username: e.target.value })}
                      autoComplete="username"
                    />
                  </div>
                  <div className="input-group">
                    <input
                      type="password"
                      placeholder="New password"
                      value={form.password}
                      onChange={e => setForm({ ...form, password: e.target.value })}
                      autoComplete="new-password"
                    />
                  </div>
                  <div className="input-group">
                    <input
                      type="password"
                      placeholder="Confirm new password"
                      value={form.confirmPassword}
                      onChange={e => setForm({ ...form, confirmPassword: e.target.value })}
                      autoComplete="new-password"
                    />
                  </div>
                </>
              )}

              {showVerifyFields && (
                <>
                  <div className="auth-step-note">
                    Verification email: <strong>{pendingEmail || form.email.trim()}</strong>
                  </div>
                  <div className="input-group">
                    <input
                      type="email"
                      placeholder="Email"
                      value={pendingEmail || form.email}
                      onChange={e => setPendingEmail(e.target.value)}
                      autoComplete="email"
                    />
                  </div>
                  <div className="input-group">
                    <input
                      type="text"
                      placeholder="6-digit OTP"
                      value={otp}
                      onChange={e => setOtp(e.target.value)}
                      inputMode="numeric"
                      maxLength={6}
                      autoComplete="one-time-code"
                    />
                  </div>
                </>
              )}

              {!showVerifyFields && !showForgotFields && !showResetFields && !showGoogleUsernameFields && (
                <>
                  <div className="input-group">
                    <input
                      type="email"
                      placeholder="Email"
                      value={form.email}
                      onChange={e => setForm({ ...form, email: e.target.value })}
                      autoComplete="email"
                    />
                  </div>
                  <div className="input-group">
                    <input
                      type="password"
                      placeholder="Password"
                      value={form.password}
                      onChange={e => setForm({ ...form, password: e.target.value })}
                      autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    />
                  </div>
                </>
              )}

              <button type="submit" className="auth-submit" disabled={loading}>
                {loading ? <span className="spinner"></span> : submitLabel}
              </button>

              {mode === 'login' && (
                <div className="auth-forgot-row">
                  <span onClick={() => switchMode('forgot-password')} className="auth-forgot-link">
                    Forgot password?
                  </span>
                </div>
              )}

              {showGoogleAuth && (
                <div className="google-auth-wrap">
                  <div className="google-divider">or continue with</div>
                  <div ref={googleButtonRef} className="google-button-slot" />
                  {!GOOGLE_CLIENT_ID ? (
                    <div className="google-loading-note">Set REACT_APP_GOOGLE_CLIENT_ID in frontend/.env to enable Google OAuth.</div>
                  ) : !googleReady ? (
                    <div className="google-loading-note">Loading Google sign-in...</div>
                  ) : null}
                </div>
              )}

              {mode === 'google-username' && (
                <button type="button" className="auth-secondary" disabled={googleLoading} onClick={() => setMode('login')}>
                  Back to login
                </button>
              )}

              {showForgotFields && (
                <button type="button" className="auth-secondary" onClick={returnToLogin}>
                  Back to login
                </button>
              )}

              {showResetFields && (
                <button type="button" className="auth-secondary" onClick={returnToLogin}>
                  Back to login
                </button>
              )}

              {showVerifyFields && (
                <button type="button" className="auth-secondary" disabled={resendLoading} onClick={resendOtp}>
                  {resendLoading ? 'Resending...' : 'Resend OTP'}
                </button>
              )}
            </form>

            <div className="auth-footer">
              {mode !== 'verify' && mode !== 'google-username' && !showForgotFields && !showResetFields ? (
                <p>
                  {mode === 'login' ? "Don't have an account?" : 'Already have an account?'}
                  <span
                    onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}
                    className="toggle-link"
                  >
                    {mode === 'login' ? 'Sign up' : 'Log in'}
                  </span>
                </p>
              ) : showForgotFields ? (
                <p>
                  Remembered your password?
                  <span onClick={returnToLogin} className="toggle-link">
                    Back to login
                  </span>
                </p>
              ) : (
                <p>
                  Already verified?
                  <span onClick={() => switchMode('login')} className="toggle-link">
                    Back to login
                  </span>
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Auth;
