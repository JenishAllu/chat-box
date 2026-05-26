import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './Home.css';

const HOME_BG_KEY = 'home_background_image';

function Home({ currentUser, onLogout, asPanel = false, onOpen }) {
  const nav = useNavigate();
  const isAuthenticated = Boolean(currentUser?._id);
  const displayName = currentUser?.displayName || currentUser?.username || 'there';
  const fileInputRef = useRef(null);
  const [backgroundImage, setBackgroundImage] = useState('');
  const [panelOnlyMode] = useState(true);

  useEffect(() => {
    const savedBackground = localStorage.getItem(HOME_BG_KEY);
    if (savedBackground) {
      setBackgroundImage(savedBackground);
    }
  }, []);

  const saveBackground = (value) => {
    setBackgroundImage(value);
    if (value) {
      localStorage.setItem(HOME_BG_KEY, value);
    } else {
      localStorage.removeItem(HOME_BG_KEY);
    }
  };

  const handleBackgroundUpload = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      saveBackground(String(e.target?.result || ''));
    };
    reader.readAsDataURL(file);
    event.target.value = '';
  };

  const presetBackgrounds = [
    'linear-gradient(135deg, #0f172a 0%, #111827 100%)',
    'linear-gradient(135deg, #1d4ed8 0%, #0f172a 100%)',
    'linear-gradient(135deg, #0ea5e9 0%, #4c1d95 100%)',
  ];

  const card = (
    <div className="home-card simple-card">
      <p className="home-kicker">{isAuthenticated ? `Welcome, ${displayName}!` : 'Welcome!'}</p>
      <div className="home-copy">
        <h1 className="home-welcome-title">Select a chat from the sidebar to start messaging.</h1>
      </div>
      <div className="home-action-inline">
        <button type="button" className="home-upload-btn" onClick={() => fileInputRef.current?.click()}>Change background</button>
        <button type="button" className="home-reset-btn" onClick={() => saveBackground('')}>Reset</button>
      </div>
      <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleBackgroundUpload} />
    </div>
  );

  if (asPanel) {
    return (
      <div style={{ padding: 8 }}>
        {card}
      </div>
    );
  }

  return (
    <div className="home-page">
      <div className="home-overlay" />
      {card}
    </div>
  );
}

export default Home;
