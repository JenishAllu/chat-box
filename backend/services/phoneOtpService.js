// Placeholder for future phone OTP support.
// This file keeps the backend structure extensible without introducing Twilio yet.

async function sendPhoneOtp() {
  throw new Error('Phone OTP service is not implemented yet');
}

module.exports = {
  sendPhoneOtp,
};