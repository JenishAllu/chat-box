import axios from 'axios';

// Initialize default Authorization header from localStorage
export default function setupAxios() {
  try {
    const token = localStorage.getItem('token');
    if (token) axios.defaults.headers.common.Authorization = `Bearer ${token}`;
  } catch (e) {
    // ignore
  }

  axios.interceptors.response.use(
    res => res,
    err => {
      const status = err?.response?.status;
      const data = err?.response?.data || {};
      if (status === 401 || (status === 404 && (data.msg === 'Account not found' || data.error === 'Account not found'))) {
        try {
          localStorage.removeItem('token');
          localStorage.removeItem('user');
        } catch (e) {}
        delete axios.defaults.headers.common.Authorization;
        // Replace the current entry so the browser back button does not jump to
        // the previous external page (for example, Google sign-in pages).
        if (typeof window !== 'undefined') {
          const baseUrl = `${window.location.origin}${window.location.pathname}${window.location.pathname.endsWith('/') ? '' : '/'}`;
          window.location.replace(`${baseUrl}#/`);
        }
      }
      return Promise.reject(err);
    }
  );
}
