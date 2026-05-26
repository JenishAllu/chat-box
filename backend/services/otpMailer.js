const nodemailer = require('nodemailer');

function pickEnv(...keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return null;
}

function getTransporter() {
  const host = pickEnv('SMTP_HOST', 'EMAIL_HOST', 'MAIL_HOST');
  const service = pickEnv('SMTP_SERVICE', 'EMAIL_SERVICE', 'MAIL_SERVICE');
  const port = Number(pickEnv('SMTP_PORT', 'EMAIL_PORT', 'MAIL_PORT') || 587);
  const secureEnv = pickEnv('SMTP_SECURE', 'EMAIL_SECURE', 'MAIL_SECURE');
  const secure = secureEnv !== null
    ? String(secureEnv).toLowerCase() === 'true'
    : (port === 465);

  const user = pickEnv('SMTP_USER', 'EMAIL_USER', 'MAIL_USER');
  const passRaw = pickEnv('SMTP_PASS', 'EMAIL_PASS', 'MAIL_PASS');
  // Some users paste app-passwords with spaces; remove whitespace to reduce errors
  const pass = passRaw ? String(passRaw).replace(/\s+/g, '') : passRaw;

  if ((!host && !service) || !user || !pass) {
    return null;
  }

  const transportOptions = {
    secure,
    auth: { user, pass },
    pool: true,
    connectionTimeout: 10000,
    socketTimeout: 10000,
    greetingTimeout: 10000,
    tls: {
      rejectUnauthorized: false,
    },
  };

  if (service) {
    transportOptions.service = service;
  } else {
    transportOptions.host = host;
    transportOptions.port = port;
  }

  try {
    const transporter = nodemailer.createTransport(transportOptions);
    // verify transporter immediately to surface config errors early
    transporter.verify().catch(err => {
      console.warn('[SMTP] transporter.verify() failed:', err && err.message ? err.message : err);
    });
    return transporter;
  } catch (err) {
    console.error('[SMTP] createTransport error', err && err.message ? err.message : err);
    return null;
  }
}

function requireTransporter(actionLabel) {
  const transporter = getTransporter();
  if (transporter) {
    return transporter;
  }

  const message = `${actionLabel} email delivery is not configured or failed to initialize. Set SMTP_HOST or SMTP_SERVICE, SMTP_USER, SMTP_PASS, and SMTP_FROM on Render (ensure SMTP_PASS is an app password if using Gmail).`;
  const allowPreviewOnly = String(process.env.OTP_PREVIEW_ONLY || '').toLowerCase() === 'true';
  if (process.env.NODE_ENV === 'production' && !allowPreviewOnly) {
    const error = new Error(message);
    error.code = 'SMTP_NOT_CONFIGURED';
    throw error;
  }

  return null;
}

async function sendVerificationOtpEmail({ to, otp }) {
  const transporter = requireTransporter('Verification OTP');
  const fromAddress =
    pickEnv('SMTP_FROM', 'EMAIL_FROM', 'MAIL_FROM', 'SMTP_USER', 'EMAIL_USER', 'MAIL_USER') ||
    'no-reply@example.com';

  const message = {
    from: fromAddress,
    to,
    subject: 'Verify your email address',
    text: `Your verification code is ${otp}. It expires in 10 minutes.`,
    html: `<p>Your verification code is <strong>${otp}</strong>.</p><p>This code expires in 10 minutes.</p>`,
  };

  if (!transporter) {
    console.warn('[OTP] SMTP not configured. Set SMTP_* (or EMAIL_*/MAIL_*) environment variables to send real emails.');
    console.log(`[OTP] Verification code for ${to}: ${otp}`);
    return { preview: true };
  }

  try {
    await transporter.sendMail(message);
    return { preview: false };
  } catch (err) {
    console.error('[OTP] Failed to send real email:', err);
    const allowPreviewOnly = String(process.env.OTP_PREVIEW_ONLY || '').toLowerCase() === 'true';
    if (allowPreviewOnly) {
      console.warn('[OTP] SMTP error caught in preview mode. Falling back to console preview.');
      console.log(`[OTP] Verification code for ${to}: ${otp}`);
      return { preview: true, fallback: true };
    }
    throw err;
  }
}

async function sendPasswordResetEmail({ to, resetUrl }) {
  const transporter = requireTransporter('Password reset link');
  const fromAddress =
    pickEnv('SMTP_FROM', 'EMAIL_FROM', 'MAIL_FROM', 'SMTP_USER', 'EMAIL_USER', 'MAIL_USER') ||
    'no-reply@example.com';

  const message = {
    from: fromAddress,
    to,
    subject: 'Reset your password',
    text: `You requested a password reset. Use this link to set a new password: ${resetUrl}`,
    html: `<p>You requested a password reset.</p><p><a href="${resetUrl}">Click here to set a new password</a></p><p>If you did not request this, you can ignore this email.</p>`,
  };

  if (!transporter) {
    console.warn('[RESET] SMTP not configured. Set SMTP_* (or EMAIL_*/MAIL_*) environment variables to send real emails.');
    console.log(`[RESET] Password reset link for ${to}: ${resetUrl}`);
    return { preview: true };
  }

  try {
    await transporter.sendMail(message);
    return { preview: false };
  } catch (err) {
    console.error('[RESET] Failed to send real email:', err);
    const allowPreviewOnly = String(process.env.OTP_PREVIEW_ONLY || '').toLowerCase() === 'true';
    if (allowPreviewOnly) {
      console.warn('[RESET] SMTP error caught in preview mode. Falling back to console preview.');
      console.log(`[RESET] Password reset link for ${to}: ${resetUrl}`);
      return { preview: true, fallback: true };
    }
    throw err;
  }
}

async function sendPasswordResetOtpEmail({ to, otp }) {
  const transporter = requireTransporter('Password reset OTP');
  const fromAddress =
    pickEnv('SMTP_FROM', 'EMAIL_FROM', 'MAIL_FROM', 'SMTP_USER', 'EMAIL_USER', 'MAIL_USER') ||
    'no-reply@example.com';

  const message = {
    from: fromAddress,
    to,
    subject: 'Reset your password with an OTP',
    text: `Use this code to reset your password: ${otp}. It expires in 10 minutes.`,
    html: `<p>Use this code to reset your password: <strong>${otp}</strong>.</p><p>This code expires in 10 minutes.</p>`,
  };

  if (!transporter) {
    console.warn('[RESET-OTP] SMTP not configured. Set SMTP_* (or EMAIL_*/MAIL_*) environment variables to send real emails.');
    console.log(`[RESET-OTP] Password reset OTP for ${to}: ${otp}`);
    return { preview: true };
  }

  try {
    await transporter.sendMail(message);
    return { preview: false };
  } catch (err) {
    console.error('[RESET-OTP] Failed to send real email:', err);
    const allowPreviewOnly = String(process.env.OTP_PREVIEW_ONLY || '').toLowerCase() === 'true';
    if (allowPreviewOnly) {
      console.warn('[RESET-OTP] SMTP error caught in preview mode. Falling back to console preview.');
      console.log(`[RESET-OTP] Password reset OTP for ${to}: ${otp}`);
      return { preview: true, fallback: true };
    }
    throw err;
  }
}

module.exports = { sendVerificationOtpEmail, sendPasswordResetEmail, sendPasswordResetOtpEmail };