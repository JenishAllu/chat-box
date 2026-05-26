
const mongoose = require("mongoose");
const messageSchema = new mongoose.Schema({
  room: String,
  from: String,
  to: String,
  message: String,
  media: {
    data: String, // base64 encoded file
    type: { type: String }, // MIME type (image/jpeg, video/mp4, etc.)
    name: String  // original filename
  },
  replyTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
  forwardedFrom: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
  isForwarded: { type: Boolean, default: false },
  isGroup: { type: Boolean, default: false },
  seen: { type: Boolean, default: false },
  isRequest: { type: Boolean, default: false },
  requestStatus: { type: String, enum: ['pending', 'accepted', 'declined'], default: 'accepted' },
  deletedBy: [{ type: String }],
  isEdited: { type: Boolean, default: false },
  reactions: [{
    userId: { type: String, required: true },
    username: { type: String, required: true },
    emoji: { type: String, required: true }
  }]
}, { timestamps: true });

messageSchema.index({ room: 1, createdAt: 1 });

module.exports = mongoose.model("Message", messageSchema);
