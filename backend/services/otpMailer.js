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
  const secure = String(pickEnv('SMTP_SECURE', 'EMAIL_SECURE', 'MAIL_SECURE') || '').toLowerCase() === 'true';
  const user = pickEnv('SMTP_USER', 'EMAIL_USER', 'MAIL_USER');
  const pass = pickEnv('SMTP_PASS', 'EMAIL_PASS', 'MAIL_PASS');

  if ((!host && !service) || !user || !pass) {
    return null;
  }

  const transportOptions = {
    secure,
    auth: { user, pass },
  };

  if (service) {
    transportOptions.service = service;
  } else {
    transportOptions.host = host;
    transportOptions.port = port;
  }

  return nodemailer.createTransport(transportOptions);
}

async function sendVerificationOtpEmail({ to, otp }) {
  const transporter = getTransporter();
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

  await transporter.sendMail(message);
  return { preview: false };
}

async function sendPasswordResetEmail({ to, resetUrl }) {
  const transporter = getTransporter();
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

  await transporter.sendMail(message);
  return { preview: false };
}

async function sendPasswordResetOtpEmail({ to, otp }) {
  const transporter = getTransporter();
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

  await transporter.sendMail(message);
  return { preview: false };
}

module.exports = { sendVerificationOtpEmail, sendPasswordResetEmail, sendPasswordResetOtpEmail };