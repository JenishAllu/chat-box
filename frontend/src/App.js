
import React, { useEffect, useState } from "react";
import { HashRouter, Navigate, Routes, Route } from "react-router-dom";
import Auth from "./components/Auth";
import Chat from "./components/Chat";

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
        <Route path="/" element={isAuthenticated ? <Navigate to="/chat" replace /> : <Auth onAuthSuccess={handleAuthSuccess} />}/>
        <Route path="/chat" element={isAuthenticated ? <Chat onLogout={handleLogout} /> : <Navigate to="/" replace />}/>
        <Route path="*" element={<Navigate to={isAuthenticated ? "/chat" : "/"} replace />} />
      </Routes>
    </HashRouter>
  );
}
export default App;
