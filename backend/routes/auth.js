const router = require('express').Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const User = require('../models/User');
const { OAuth2Client } = require('google-auth-library');
const { validateUsername } = require('../utils/usernameValidator');
const { applyTrustUpdate } = require('../utils/accountTrust');
const { sanitizeUser } = require('../utils/sanitizeUser');
const { sendVerificationOtpEmail, sendPasswordResetEmail, sendPasswordResetOtpEmail } = require('../services/otpMailer');

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

async function verifyGoogleIdToken(idToken) {
  const primary = process.env.GOOGLE_CLIENT_ID ? [process.env.GOOGLE_CLIENT_ID] : [];
  const extras = process.env.GOOGLE_CLIENT_IDS ? String(process.env.GOOGLE_CLIENT_IDS).split(',').map(s => s.trim()).filter(Boolean) : [];
  const audiences = Array.from(new Set([...primary, ...extras]));
  let lastErr = null;
  for (const aud of audiences) {
    try {
      const ticket = await googleClient.verifyIdToken({ idToken, audience: aud });
      return ticket;
    } catch (err) {
      // prefer to continue on audience mismatch, but propagate other errors
      lastErr = err;
      const msg = err && (err.message || err.toString()) || '';
      if (msg.toLowerCase().includes('wrong recipient') || msg.toLowerCase().includes('payload audience')) {
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error('Google token verification failed');
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false,
});

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function hashValue(value) {
  return crypto.createHash('sha256').update(String(value).trim()).digest('hex');
}

function signToken(user) {
  return jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

function validatePassword(password) {
  if (String(password || '').length < 8) {
    return 'Password must be at least 8 characters long';
  }
  return null;
}

function getFrontendBaseUrl() {
  return process.env.FRONTEND_URL || process.env.CLIENT_ORIGIN || 'http://localhost:3000';
}

function buildPasswordResetUrl(token) {
  return `${getFrontendBaseUrl()}/#/reset-password?token=${encodeURIComponent(token)}`;
}

function shouldShowPreview(req) {
  const allowPreviewOnly = String(process.env.OTP_PREVIEW_ONLY || '').toLowerCase() === 'true';
  // If preview is allowed (local, sandboxed, or fallback mode), always return true
  if (allowPreviewOnly) return true;
  // always show in non-production (local dev)
  if (process.env.NODE_ENV !== 'production') return true;

  // require explicit request: header or query param
  if (!req) return false;
  const h = req.headers['x-otp-preview'] || req.headers['x-show-preview'] || req.query && req.query.otp_preview;
  if (!h) return false;
  return String(h) === '1' || String(h).toLowerCase() === 'true';
}

router.post('/register', authLimiter, async (req, res) => {
  try {
    const { username, email, password, realName } = req.body;
    if (!username || !email || !password || !realName) {
      return res.status(400).json({ msg: 'Username, email, password, and full name are required' });
    }

    const usernameCheck = validateUsername(username);
    if (!usernameCheck.valid) {
      return res.status(400).json({ msg: usernameCheck.message });
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      return res.status(400).json({ msg: passwordError });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const existing = await User.findOne({ $or: [{ email: normalizedEmail }, { username: usernameCheck.username }] });
    if (existing) {
      return res.status(400).json({ msg: 'Username or email already exists' });
    }

    const otp = generateOtp();
    const hashed = await bcrypt.hash(password, 12);
    let user;

    try {
      user = await User.create({
        username: usernameCheck.username,
        email: normalizedEmail,
        password: hashed,
        realName: String(realName).trim(),
        displayName: String(realName).trim(),
        verified: false,
        emailOtp: otp,
        otpExpiry: new Date(Date.now() + 10 * 60 * 1000),
      });

      applyTrustUpdate(user, { reason: 'register' });
      await user.save();
    } catch (createErr) {
      if (user && user._id) {
        try {
          await User.findByIdAndDelete(user._id);
        } catch (cleanupErr) {
          console.error('register rollback error', cleanupErr);
        }
      }
      throw createErr;
    }

    let sendResult;
    try {
      sendResult = await sendVerificationOtpEmail({ to: normalizedEmail, otp });
    } catch (mailErr) {
      try {
        await User.findByIdAndDelete(user._id);
      } catch (cleanupErr) {
        console.error('register rollback error', cleanupErr);
      }
      if (mailErr && mailErr.code === 'SMTP_NOT_CONFIGURED') {
        return res.status(503).json({ msg: mailErr.message });
      }
      return res.status(503).json({ msg: 'Registration failed. Could not send OTP. Please try again.' });
    }

    const responseBody = {
      msg: 'Registration successful. Please verify your email address.',
      verificationRequired: true,
      email: normalizedEmail,
      userId: user._id,
      preview: !!(sendResult && sendResult.preview),
    };
    if (shouldShowPreview(req) && sendResult && sendResult.preview) {
      responseBody.otp = otp;
    }

    return res.status(201).json(responseBody);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ msg: 'Username or email already exists' });
    }
    console.error('register error', err);
    return res.status(500).json({ msg: 'Registration failed' });
  }
});

router.post('/verify-otp', authLimiter, async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res.status(400).json({ msg: 'Email and OTP are required' });
    }

    const user = await User.findOne({ email: String(email).trim().toLowerCase() });
    if (!user) {
      return res.status(404).json({ msg: 'Account not found' });
    }

    if (user.verified) {
      return res.json({ msg: 'Email already verified', verified: true });
    }

    if (!user.emailOtp || !user.otpExpiry || new Date(user.otpExpiry).getTime() < Date.now()) {
      return res.status(400).json({ msg: 'OTP expired. Please request a new code.' });
    }

    if (String(user.emailOtp) !== String(otp).trim()) {
      return res.status(400).json({ msg: 'Invalid OTP' });
    }

    user.verified = true;
    user.emailOtp = null;
    user.otpExpiry = null;
    applyTrustUpdate(user, { reason: 'verification' });
    user.isBlocked = false;
    await user.save();

    return res.json({
      msg: 'Email verified successfully',
      verified: true,
      user: sanitizeUser(user),
    });
  } catch (err) {
    console.error('verify otp error', err);
    return res.status(500).json({ msg: err.code === 'SMTP_NOT_CONFIGURED' ? err.message : 'OTP verification failed' });
  }
});

router.post('/resend-otp', authLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ msg: 'Email is required' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(404).json({ msg: 'Account not found' });
    }

    if (user.verified) {
      return res.status(400).json({ msg: 'Account is already verified' });
    }

    const otp = generateOtp();
    user.emailOtp = otp;
    user.otpExpiry = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();

    const sendResult = await sendVerificationOtpEmail({ to: normalizedEmail, otp });

    const resp = { msg: 'Verification code resent', preview: !!(sendResult && sendResult.preview) };
    if (shouldShowPreview(req) && sendResult && sendResult.preview) {
      resp.otp = otp;
    }

    return res.json(resp);
  } catch (err) {
    console.error('resend otp error', err);
    return res.status(500).json({ msg: err.code === 'SMTP_NOT_CONFIGURED' ? err.message : 'Failed to resend OTP' });
  }
});

router.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ msg: 'Email and password required' });
    }

    const user = await User.findOne({ email: String(email).trim().toLowerCase() });
    if (!user) return res.status(400).json({ msg: 'Invalid credentials' });
    if (user.isBlocked) return res.status(403).json({ msg: 'Account is blocked' });
    if (!user.verified) {
      return res.status(403).json({
        msg: 'Email verification required',
        pendingVerification: true,
        email: user.email,
      });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ msg: 'Invalid credentials' });

    user.reputation = Math.min(100, Number(user.reputation || 100) + 1);
    await user.save();

    const token = signToken(user);
    return res.json({ token, user: sanitizeUser(user) });
  } catch (err) {
    console.error('login error', err);
    return res.status(500).json({ msg: 'Login failed' });
  }
});

router.post('/forgot-password', authLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ msg: 'Email is required' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(404).json({ msg: 'Account not found' });
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    user.passwordResetTokenHash = tokenHash;
    user.passwordResetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000);
    await user.save();

    const resetUrl = buildPasswordResetUrl(rawToken);
    const sendResult = await sendPasswordResetEmail({ to: normalizedEmail, resetUrl });

    const responseBody = { msg: 'If the account exists, a reset link has been sent.', preview: !!(sendResult && sendResult.preview) };
    if (shouldShowPreview(req) && sendResult && sendResult.preview) {
      responseBody.resetUrl = resetUrl;
    }

    return res.json(responseBody);
  } catch (err) {
    console.error('forgot password error', err);
    return res.status(500).json({ msg: err.code === 'SMTP_NOT_CONFIGURED' ? err.message : 'Failed to send password reset link' });
  }
});

router.post('/forgot-password-otp', authLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ msg: 'Email is required' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(404).json({ msg: 'Account not found' });
    }

    const otp = generateOtp();
    user.passwordResetOtpHash = hashValue(otp);
    user.passwordResetOtpExpiry = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();

    const sendResult = await sendPasswordResetOtpEmail({ to: normalizedEmail, otp });

    const responseBody = { msg: 'If the account exists, an OTP has been sent.', preview: !!(sendResult && sendResult.preview) };
    if (shouldShowPreview(req) && sendResult && sendResult.preview) {
      responseBody.otp = otp;
    }

    return res.json(responseBody);
  } catch (err) {
    console.error('forgot password otp error', err);
    return res.status(500).json({ msg: err.code === 'SMTP_NOT_CONFIGURED' ? err.message : 'Failed to send password reset OTP' });
  }
});

router.post('/reset-password', authLimiter, async (req, res) => {
  try {
    const { token, otp, email, password } = req.body;
    if ((!token && !otp) || !password) {
      return res.status(400).json({ msg: 'Reset token/OTP and new password are required' });
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      return res.status(400).json({ msg: passwordError });
    }

    let user;
    if (token) {
      const tokenHash = hashValue(token);
      user = await User.findOne({
        passwordResetTokenHash: tokenHash,
        passwordResetTokenExpiry: { $gt: new Date() },
      });
    } else {
      if (!email) {
        return res.status(400).json({ msg: 'Email is required for OTP reset' });
      }

      const normalizedEmail = String(email).trim().toLowerCase();
      const otpHash = hashValue(otp);
      user = await User.findOne({
        email: normalizedEmail,
        passwordResetOtpHash: otpHash,
        passwordResetOtpExpiry: { $gt: new Date() },
      });
    }

    if (!user) {
      return res.status(400).json({ msg: 'Reset link is invalid or expired' });
    }

    user.password = await bcrypt.hash(password, 12);
    user.passwordResetTokenHash = null;
    user.passwordResetTokenExpiry = null;
    user.passwordResetOtpHash = null;
    user.passwordResetOtpExpiry = null;
    await user.save();

    return res.json({ msg: 'Password reset successfully' });
  } catch (err) {
    console.error('reset password error', err);
    return res.status(500).json({ msg: 'Password reset failed' });
  }
});

router.post('/google', authLimiter, async (req, res) => {
  try {
    const { idToken, username, password } = req.body;
    if (!idToken) return res.status(400).json({ msg: 'idToken is required' });

    const ticket = await verifyGoogleIdToken(idToken);
    const payload = ticket.getPayload();
    const email = String(payload.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ msg: 'Google account has no email' });

    let user = await User.findOne({ $or: [{ googleId: payload.sub }, { email }] });
    if (user && user.isBlocked) return res.status(403).json({ msg: 'Account is blocked' });

    if (!user) {
      if (!username) {
        return res.status(200).json({
          needsUsername: true,
          email,
          googleId: payload.sub,
          displayName: payload.name || '',
          picture: payload.picture || '',
        });
      }

      const usernameCheck = validateUsername(username);
      if (!usernameCheck.valid) {
        return res.status(400).json({ msg: usernameCheck.message });
      }

      const existingUsername = await User.findOne({ username: usernameCheck.username });
      if (existingUsername) {
        return res.status(400).json({ msg: 'Username already exists' });
      }

      // If a password was provided during the username step, validate
      // and use it as the account's local password. Otherwise generate
      // a random password so the account has a password hashed in DB.
      let hashed;
      if (password) {
        const passwordError = validatePassword(password);
        if (passwordError) {
          return res.status(400).json({ msg: passwordError });
        }
        hashed = await bcrypt.hash(password, 12);
      } else {
        const randomPw = Math.random().toString(36).slice(2);
        hashed = await bcrypt.hash(randomPw, 12);
      }

      user = new User({
        username: usernameCheck.username,
        email,
        password: hashed,
        realName: payload.name || usernameCheck.username,
        displayName: payload.name || usernameCheck.username,
        verified: true,
        avatar: payload.picture || null,
        googleId: payload.sub,
      });
      applyTrustUpdate(user, { reason: 'google-oauth' });
      await user.save();
    } else {
      // link googleId if missing
      if (!user.googleId) {
        user.googleId = payload.sub;
      }
      user.verified = true;
      if (!user.displayName && payload.name) user.displayName = payload.name;
      if (!user.avatar && payload.picture) user.avatar = payload.picture;
      await user.save();
    }

    const token = signToken(user);
    return res.json({ token, user: sanitizeUser(user) });
  } catch (err) {
    console.error('google auth error', err);
    return res.status(500).json({ msg: 'Google authentication failed' });
  }
});

module.exports = router;
