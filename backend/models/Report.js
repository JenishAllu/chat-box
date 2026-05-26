const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema({
  reporter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  target: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  reason: { type: String, required: true, trim: true, maxlength: 500 },
  details: { type: String, default: '', trim: true, maxlength: 2000 },
  status: { type: String, enum: ['open', 'reviewed', 'dismissed'], default: 'open' },
  riskSnapshot: {
    suspiciousScore: { type: Number, default: 0 },
    accountRiskLevel: { type: String, enum: ['low', 'medium', 'high'], default: 'low' },
  },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

reportSchema.index({ reporter: 1, target: 1 }, { unique: true });

module.exports = mongoose.model('Report', reportSchema);