
import React from "react";
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
  const isAuthenticated = Boolean(getStoredUser());

  return(
    <HashRouter>
      <Routes>
        <Route path="/" element={isAuthenticated ? <Navigate to="/chat" replace /> : <Auth/>}/>
        <Route path="/chat" element={isAuthenticated ? <Chat/> : <Navigate to="/" replace />}/>
        <Route path="*" element={<Navigate to={isAuthenticated ? "/chat" : "/"} replace />} />
      </Routes>
    </HashRouter>
  );
}
export default App;
