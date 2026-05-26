const router = require('express').Router();
const { sendPasswordResetEmail, sendVerificationOtpEmail } = require('../services/otpMailer');

router.post('/send-test-email', async (req, res) => {
  try {
    const { to, type } = req.body || {};
    if (!to) return res.status(400).json({ msg: 'Recipient `to` is required' });

    if (type === 'reset') {
      const resetUrl = req.body.resetUrl || `${process.env.FRONTEND_URL || process.env.CLIENT_ORIGIN || 'http://localhost:3000'}/#/reset-password?token=TEST`;
      const sendResult = await sendPasswordResetEmail({ to, resetUrl });
      return res.json({ msg: 'Test reset email sent', preview: !!sendResult.preview });
    }

    const otp = req.body.otp || '123456';
    const sendResult = await sendVerificationOtpEmail({ to, otp });
    return res.json({ msg: 'Test verification email sent', preview: !!sendResult.preview });
  } catch (err) {
    console.error('debug send-test-email error', err && err.message ? err.message : err);
    return res.status(500).json({ msg: err.code === 'SMTP_NOT_CONFIGURED' ? err.message : 'Failed to send test email', error: err.message || String(err) });
  }
});

module.exports = router;
