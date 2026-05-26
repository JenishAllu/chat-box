const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { sanitizeUser } = require('../utils/sanitizeUser');

module.exports = async function socketAuthMiddleware(socket, next) {
  try {
    const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, '');
    if (!token) {
      return next(new Error('Authentication required'));
    }

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.id);
    if (!user || user.isBlocked || !user.verified) {
      return next(new Error('Authentication failed'));
    }

    socket.data.user = sanitizeUser(user);
    return next();
  } catch (err) {
    return next(new Error('Authentication failed')); 
  }
};