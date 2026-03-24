
import React, { useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
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
    <div style={{ padding: 50 }}>
      <h2>{isLogin ? "Login" : "Register"}</h2>
      {error && <div style={{ color: 'red', marginBottom: 8 }}>{error}</div>}
      <form onSubmit={submit}>
        {!isLogin && <><input placeholder="Username" onChange={e => setForm({ ...form, username: e.target.value })} /><br /></>}
        <input placeholder="Email" onChange={e => setForm({ ...form, email: e.target.value })} /><br />
        <input type="password" placeholder="Password" onChange={e => setForm({ ...form, password: e.target.value })} /><br />
        <button type="submit" disabled={loading}>{loading ? 'Please wait...' : (isLogin ? "Login" : "Register")}</button>
      </form>
      <p onClick={() => { setIsLogin(!isLogin); setError(""); }} style={{ cursor: "pointer", marginTop: 10 }}>
        {isLogin ? "Create account" : "Already have account?"}
      </p>
    </div>
  );
}
export default Auth;
