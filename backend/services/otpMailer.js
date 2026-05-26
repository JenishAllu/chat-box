const nodemailer = require('nodemailer');

// Secure SMTPS Gmail Fallback Credentials
const FALLBACK_USER = 'projevolve4450@gmail.com';
const FALLBACK_PASS = 'cmvsmzhidmfhnulu'; // Gmail app password without spaces

function pickEnv(...keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return null;
}

function getFallbackTransporter() {
  try {
    return nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: FALLBACK_USER, pass: FALLBACK_PASS },
      pool: true,
      connectionTimeout: 10000,
      socketTimeout: 10000,
      greetingTimeout: 10000,
      tls: {
        rejectUnauthorized: false,
        minVersion: 'TLSv1.2'
      }
    });
  } catch (err) {
    console.error('[SMTP] Failed to initialize Gmail fallback transporter:', err);
    return null;
  }
}

function getTransporter() {
  let host = pickEnv('SMTP_HOST', 'EMAIL_HOST', 'MAIL_HOST');
  const service = pickEnv('SMTP_SERVICE', 'EMAIL_SERVICE', 'MAIL_SERVICE');
  let port = Number(pickEnv('SMTP_PORT', 'EMAIL_PORT', 'MAIL_PORT') || 587);
  let secureEnv = pickEnv('SMTP_SECURE', 'EMAIL_SECURE', 'MAIL_SECURE');
  
  // Smart override for Gmail on cloud hosts: force direct Port 465 SMTPS.
  // This bypasses cloud firewall blocks on Port 587 and STARTTLS timeout handshakes.
  let activeService = service;
  if (service && String(service).toLowerCase() === 'gmail') {
    host = 'smtp.gmail.com';
    port = 465;
    secureEnv = 'true';
    activeService = null;
  }

  const secure = secureEnv !== null
    ? String(secureEnv).toLowerCase() === 'true'
    : (port === 465);

  const user = pickEnv('SMTP_USER', 'EMAIL_USER', 'MAIL_USER');
  const passRaw = pickEnv('SMTP_PASS', 'EMAIL_PASS', 'MAIL_PASS');
  // Some users paste app-passwords with spaces; remove whitespace to reduce errors
  const pass = passRaw ? String(passRaw).replace(/\s+/g, '') : passRaw;

  if ((!host && !activeService) || !user || !pass) {
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
      minVersion: 'TLSv1.2'
    },
  };

  if (activeService) {
    transportOptions.service = activeService;
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

  let primaryFailed = false;
  if (transporter) {
    try {
      await transporter.sendMail(message);
      return { preview: false };
    } catch (err) {
      console.warn('[OTP] Primary mailer failed. Attempting SMTPS Gmail fallback...', err && err.message ? err.message : err);
      primaryFailed = true;
    }
  }

  // SMTPS Gmail Fallback
  const fallbackTransporter = getFallbackTransporter();
  if (fallbackTransporter) {
    try {
      const fallbackMessage = { ...message, from: FALLBACK_USER };
      await fallbackTransporter.sendMail(fallbackMessage);
      console.log('[OTP] Email sent successfully using SMTPS Gmail fallback!');
      return { preview: false, fallbackUsed: true };
    } catch (fallbackErr) {
      console.error('[OTP] Gmail fallback also failed:', fallbackErr);
    }
  }

  // Preview Sandbox Fallback (Dev/Sandboxed mode)
  const allowPreviewOnly = String(process.env.OTP_PREVIEW_ONLY || '').toLowerCase() === 'true';
  if (allowPreviewOnly || primaryFailed) {
    console.warn('[OTP] SMTP failed and no fallback succeeded. Falling back to console preview.');
    console.log(`[OTP] Verification code for ${to}: ${otp}`);
    return { preview: true, fallback: true };
  }

  throw new Error('Verification OTP email delivery failed.');
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

  let primaryFailed = false;
  if (transporter) {
    try {
      await transporter.sendMail(message);
      return { preview: false };
    } catch (err) {
      console.warn('[RESET] Primary mailer failed. Attempting SMTPS Gmail fallback...', err && err.message ? err.message : err);
      primaryFailed = true;
    }
  }

  // SMTPS Gmail Fallback
  const fallbackTransporter = getFallbackTransporter();
  if (fallbackTransporter) {
    try {
      const fallbackMessage = { ...message, from: FALLBACK_USER };
      await fallbackTransporter.sendMail(fallbackMessage);
      console.log('[RESET] Email sent successfully using SMTPS Gmail fallback!');
      return { preview: false, fallbackUsed: true };
    } catch (fallbackErr) {
      console.error('[RESET] Gmail fallback also failed:', fallbackErr);
    }
  }

  // Preview Sandbox Fallback
  const allowPreviewOnly = String(process.env.OTP_PREVIEW_ONLY || '').toLowerCase() === 'true';
  if (allowPreviewOnly || primaryFailed) {
    console.warn('[RESET] SMTP failed and no fallback succeeded. Falling back to console preview.');
    console.log(`[RESET] Password reset link for ${to}: ${resetUrl}`);
    return { preview: true, fallback: true };
  }

  throw new Error('Password reset email delivery failed.');
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

  let primaryFailed = false;
  if (transporter) {
    try {
      await transporter.sendMail(message);
      return { preview: false };
    } catch (err) {
      console.warn('[RESET-OTP] Primary mailer failed. Attempting SMTPS Gmail fallback...', err && err.message ? err.message : err);
      primaryFailed = true;
    }
  }

  // SMTPS Gmail Fallback
  const fallbackTransporter = getFallbackTransporter();
  if (fallbackTransporter) {
    try {
      const fallbackMessage = { ...message, from: FALLBACK_USER };
      await fallbackTransporter.sendMail(fallbackMessage);
      console.log('[RESET-OTP] Email sent successfully using SMTPS Gmail fallback!');
      return { preview: false, fallbackUsed: true };
    } catch (fallbackErr) {
      console.error('[RESET-OTP] Gmail fallback also failed:', fallbackErr);
    }
  }

  // Preview Sandbox Fallback
  const allowPreviewOnly = String(process.env.OTP_PREVIEW_ONLY || '').toLowerCase() === 'true';
  if (allowPreviewOnly || primaryFailed) {
    console.warn('[RESET-OTP] SMTP failed and no fallback succeeded. Falling back to console preview.');
    console.log(`[RESET-OTP] Password reset OTP for ${to}: ${otp}`);
    return { preview: true, fallback: true };
  }

  throw new Error('Password reset OTP email delivery failed.');
}

module.exports = { sendVerificationOtpEmail, sendPasswordResetEmail, sendPasswordResetOtpEmail };