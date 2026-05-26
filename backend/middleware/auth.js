const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { sanitizeUser } = require('../utils/sanitizeUser');

function getTokenFromHeader(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) {
    return header.slice(7);
  }
  return null;
}

module.exports = async function authMiddleware(req, res, next) {
  try {
    const token = getTokenFromHeader(req) || req.body?.token || req.query?.token;
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.id);
    if (!user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    if (user.isBlocked) {
      return res.status(403).json({ error: 'Account is blocked' });
    }

    if (!user.verified) {
      return res.status(403).json({ error: 'Email verification required' });
    }

    req.user = sanitizeUser(user);
    req.token = token;
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};