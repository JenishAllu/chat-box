function sanitizeUser(user) {
  if (!user) return null;
  const plain = typeof user.toObject === 'function' ? user.toObject() : { ...user };
  delete plain.password;
  delete plain.emailOtp;
  delete plain.otpExpiry;
  return plain;
}

module.exports = { sanitizeUser };