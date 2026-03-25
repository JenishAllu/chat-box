
import React, { useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import "./Auth.css";

function Auth() {
  const nav = useNavigate();
  const [isLogin, setIsLogin] = useState(true);
  const [form, setForm] = useState({ username: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const submit = async (e) => {
    if (e) e.preventDefault();
    setError("");
    if (!form.email.trim() || !form.password.trim() || (!isLogin && !form.username.trim())) {
      setError("All fields are required");
      return;
    }
    setLoading(true);
    try {
      const url = isLogin ? "/login" : "/register";
      const res = await axios.post("http://localhost:5000/api/auth" + url, form);
      localStorage.setItem("user", JSON.stringify(res.data.user));
      nav("/chat");
    } catch (err) {
      console.error('auth error', err);
      setError(err.response?.data?.msg || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-header">
          <h2>{isLogin ? "Welcome Back" : "Create Account"}</h2>
          <p>{isLogin ? "Log in to continue your journey" : "Join us to get started with Insta Chat"}</p>
        </div>
        
        {error && <div className="auth-error">{error}</div>}
        
        <form onSubmit={submit} className="auth-form">
          {!isLogin && (
            <div className="input-group">
              <input 
                type="text" 
                placeholder="Username" 
                value={form.username}
                onChange={e => setForm({ ...form, username: e.target.value })} 
              />
            </div>
          )}
          <div className="input-group">
            <input 
              type="email" 
              placeholder="Email" 
              value={form.email}
              onChange={e => setForm({ ...form, email: e.target.value })} 
            />
          </div>
          <div className="input-group">
            <input 
              type="password" 
              placeholder="Password" 
              value={form.password}
              onChange={e => setForm({ ...form, password: e.target.value })} 
            />
          </div>
          <button type="submit" className="auth-submit" disabled={loading}>
            {loading ? <span className="spinner"></span> : (isLogin ? "Login" : "Register")}
          </button>
        </form>
        
        <div className="auth-footer">
          <p>
            {isLogin ? "Don't have an account?" : "Already have an account?"}
            <span onClick={() => { setIsLogin(!isLogin); setError(""); }} className="toggle-link">
              {isLogin ? "Sign up" : "Log in"}
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}
export default Auth;
