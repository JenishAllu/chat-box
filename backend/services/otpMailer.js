const nodemailer = require('nodemailer');
const https = require('https');

function pickEnv(...keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return null;
}

// REST HTTPS API call to Brevo (runs on standard port 443, bypassing all SMTP port blocks)
function sendEmailViaBrevoApi({ to, subject, text, html, apiKey, fromEmail }) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      sender: { email: fromEmail || 'no-reply@example.com', name: 'Insta Chat' },
      to: [{ email: to }],
      subject: subject,
      textContent: text,
      htmlContent: html
    });

    const options = {
      hostname: 'api.brevo.com',
      port: 443,
      path: '/v3/smtp/email',
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': apiKey,
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(data)
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve({ success: true });
          }
        } else {
          reject(new Error(`Brevo API returned status ${res.statusCode}: ${body}`));
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.write(data);
    req.end();
  });
}

function getTransporter() {
  let host = pickEnv('SMTP_HOST', 'EMAIL_HOST', 'MAIL_HOST');
  const service = pickEnv('SMTP_SERVICE', 'EMAIL_SERVICE', 'MAIL_SERVICE');
  let port = Number(pickEnv('SMTP_PORT', 'EMAIL_PORT', 'MAIL_PORT') || 587);
  let secureEnv = pickEnv('SMTP_SECURE', 'EMAIL_SECURE', 'MAIL_SECURE');
  
  // Smart override for Gmail locally/cloud: force direct Port 465 SMTPS
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

  const message = `${actionLabel} email delivery is not configured or failed to initialize. Set SMTP_HOST or SMTP_SERVICE, SMTP_USER, SMTP_PASS, and SMTP_FROM on Render.`;
  const allowPreviewOnly = String(process.env.OTP_PREVIEW_ONLY || '').toLowerCase() === 'true';
  if (process.env.NODE_ENV === 'production' && !allowPreviewOnly) {
    const error = new Error(message);
    error.code = 'SMTP_NOT_CONFIGURED';
    throw error;
  }

  return null;
}

async function sendVerificationOtpEmail({ to, otp }) {
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

  const passRaw = pickEnv('SMTP_PASS', 'EMAIL_PASS', 'MAIL_PASS') || '';
  const pass = String(passRaw).replace(/\s+/g, '');

  // 1. DYNAMIC HTTPS WEB API BYPASS FOR BREVO (RENDER-FRIENDLY & SECURE)
  if (pass.startsWith('xsmtpsib')) {
    console.log('[OTP] Brevo API Key detected. Bypassing SMTP and using secure HTTPS Web API...');
    try {
      await sendEmailViaBrevoApi({
        to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        apiKey: pass,
        fromEmail: fromAddress
      });
      console.log('[OTP] Email sent successfully via Brevo HTTPS API!');
      return { preview: false };
    } catch (err) {
      console.error('[OTP] Brevo HTTPS API failed:', err && err.message ? err.message : err);
    }
  }

  // 2. PRIMARY SMTP (GMAIL OVER PORT 465 OR CUSTOM SMTP RELAY)
  const transporter = requireTransporter('Verification OTP');
  let primaryFailed = false;
  if (transporter) {
    try {
      await transporter.sendMail(message);
      return { preview: false };
    } catch (err) {
      console.warn('[OTP] SMTP delivery failed:', err && err.message ? err.message : err);
      primaryFailed = true;
    }
  }

  // 3. PREVIEW SANDBOX
  const allowPreviewOnly = String(process.env.OTP_PREVIEW_ONLY || '').toLowerCase() === 'true';
  if (allowPreviewOnly || primaryFailed) {
    console.warn('[OTP] Falling back to console preview.');
    console.log(`[OTP] Verification code for ${to}: ${otp}`);
    return { preview: true, fallback: true };
  }

  throw new Error('Verification OTP email delivery failed.');
}

async function sendPasswordResetEmail({ to, resetUrl }) {
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

  const passRaw = pickEnv('SMTP_PASS', 'EMAIL_PASS', 'MAIL_PASS') || '';
  const pass = String(passRaw).replace(/\s+/g, '');

  // 1. DYNAMIC HTTPS WEB API BYPASS FOR BREVO (RENDER-FRIENDLY & SECURE)
  if (pass.startsWith('xsmtpsib')) {
    console.log('[RESET] Brevo API Key detected. Bypassing SMTP and using secure HTTPS Web API...');
    try {
      await sendEmailViaBrevoApi({
        to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        apiKey: pass,
        fromEmail: fromAddress
      });
      console.log('[RESET] Email sent successfully via Brevo HTTPS API!');
      return { preview: false };
    } catch (err) {
      console.error('[RESET] Brevo HTTPS API failed:', err && err.message ? err.message : err);
    }
  }

  // 2. PRIMARY SMTP
  const transporter = requireTransporter('Password reset link');
  let primaryFailed = false;
  if (transporter) {
    try {
      await transporter.sendMail(message);
      return { preview: false };
    } catch (err) {
      console.warn('[RESET] SMTP delivery failed:', err && err.message ? err.message : err);
      primaryFailed = true;
    }
  }

  // 3. PREVIEW SANDBOX
  const allowPreviewOnly = String(process.env.OTP_PREVIEW_ONLY || '').toLowerCase() === 'true';
  if (allowPreviewOnly || primaryFailed) {
    console.warn('[RESET] Falling back to console preview.');
    console.log(`[RESET] Password reset link for ${to}: ${resetUrl}`);
    return { preview: true, fallback: true };
  }

  throw new Error('Password reset email delivery failed.');
}

async function sendPasswordResetOtpEmail({ to, otp }) {
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

  const passRaw = pickEnv('SMTP_PASS', 'EMAIL_PASS', 'MAIL_PASS') || '';
  const pass = String(passRaw).replace(/\s+/g, '');

  // 1. DYNAMIC HTTPS WEB API BYPASS FOR BREVO (RENDER-FRIENDLY & SECURE)
  if (pass.startsWith('xsmtpsib')) {
    console.log('[RESET-OTP] Brevo API Key detected. Bypassing SMTP and using secure HTTPS Web API...');
    try {
      await sendEmailViaBrevoApi({
        to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        apiKey: pass,
        fromEmail: fromAddress
      });
      console.log('[RESET-OTP] Email sent successfully via Brevo HTTPS API!');
      return { preview: false };
    } catch (err) {
      console.error('[RESET-OTP] Brevo HTTPS API failed:', err && err.message ? err.message : err);
    }
  }

  // 2. PRIMARY SMTP
  const transporter = requireTransporter('Password reset OTP');
  let primaryFailed = false;
  if (transporter) {
    try {
      await transporter.sendMail(message);
      return { preview: false };
    } catch (err) {
      console.warn('[RESET-OTP] SMTP delivery failed:', err && err.message ? err.message : err);
      primaryFailed = true;
    }
  }

  // 3. PREVIEW SANDBOX
  const allowPreviewOnly = String(process.env.OTP_PREVIEW_ONLY || '').toLowerCase() === 'true';
  if (allowPreviewOnly || primaryFailed) {
    console.warn('[RESET-OTP] Falling back to console preview.');
    console.log(`[RESET-OTP] Password reset OTP for ${to}: ${otp}`);
    return { preview: true, fallback: true };
  }

  throw new Error('Password reset OTP email delivery failed.');
}

module.exports = { sendVerificationOtpEmail, sendPasswordResetEmail, sendPasswordResetOtpEmail };