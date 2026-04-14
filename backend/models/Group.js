const mongoose = require('mongoose');

const groupSchema = new mongoose.Schema({
  name: { type: String, required: true },
  avatar: { type: String },
  members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  // Legacy single-admin field kept for backward compatibility.
  admin: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  // Preferred multi-admin field.
  admins: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
}, { timestamps: true });

module.exports = mongoose.model('Group', groupSchema);
