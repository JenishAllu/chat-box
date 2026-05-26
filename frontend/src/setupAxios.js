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
        // force navigate to login
        if (typeof window !== 'undefined') {
          window.location.href = '/';
        }
      }
      return Promise.reject(err);
    }
  );
}
