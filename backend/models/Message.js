
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
  seen: { type: Boolean, default: false }
}, { timestamps: true });
module.exports = mongoose.model("Message", messageSchema);
