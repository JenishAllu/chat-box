
import React, { useEffect, useState } from "react";
import { HashRouter, Navigate, Routes, Route } from "react-router-dom";
import Auth from "./components/Auth";
import Chat from "./components/Chat";

const APP_HOME_HASH = '#/';

function getStoredUser() {
  try {
    const raw = localStorage.getItem("user");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && parsed._id ? parsed : null;
  } catch {
    return null;
  }
}

function App(){
  const [currentUser, setCurrentUser] = useState(getStoredUser());

  useEffect(() => {
    const handleStorageChange = () => setCurrentUser(getStoredUser());
    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const homeUrl = `${window.location.origin}${window.location.pathname}${APP_HOME_HASH}`;
    const ensureHomeHash = () => {
      if (!window.location.hash || !window.location.hash.startsWith('#/')) {
        window.location.replace(homeUrl);
        return false;
      }
      return true;
    };

    if (!ensureHomeHash()) {
      return undefined;
    }

    if (!window.history.state || !window.history.state.appShell) {
      window.history.replaceState({ ...(window.history.state || {}), appShell: true }, '', homeUrl);
    }

    const handlePopState = () => {
      if (!window.location.hash || !window.location.hash.startsWith('#/')) {
        window.history.pushState({ appShell: true }, '', homeUrl);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const handleAuthSuccess = () => {
    setCurrentUser(getStoredUser());
  };

  const handleLogout = () => {
    localStorage.removeItem("user");
    localStorage.removeItem("token");
    setCurrentUser(null);
  };

  const isAuthenticated = Boolean(currentUser?._id);

  return(
    <HashRouter>
      <Routes>
        <Route path="/reset-password" element={<Auth onAuthSuccess={handleAuthSuccess} />}/>
        <Route path="/" element={<Navigate to="/chat" replace />} />
        <Route path="/auth" element={isAuthenticated ? <Navigate to="/chat" replace /> : <Auth onAuthSuccess={handleAuthSuccess} />}/>
        <Route path="/login" element={isAuthenticated ? <Navigate to="/chat" replace /> : <Auth onAuthSuccess={handleAuthSuccess} />}/>
        <Route path="/chat" element={isAuthenticated ? <Chat onLogout={handleLogout} /> : <Navigate to="/auth" replace />}/>
        <Route path="*" element={<Navigate to={isAuthenticated ? "/chat" : "/auth"} replace />} />
      </Routes>
    </HashRouter>
  );
}
export default App;
