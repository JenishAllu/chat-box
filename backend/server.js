
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const cors = require("cors");
const helmet = require("helmet");
const mongoSanitize = require("express-mongo-sanitize");
const Message = require("./models/Message");
const socketAuth = require("./middleware/socketAuth");
const path = require("path");

// Load environment variables using absolute path of backend/.env
dotenv.config({ path: path.join(__dirname, ".env") });

const PORT = process.env.PORT || 5000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "*";

function parseOrigins(value) {
  if (!value || value === '*') return '*';
  const origins = String(value)
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
  return origins.length > 0 ? origins : '*';
}

const allowedOrigins = parseOrigins(process.env.CLIENT_ORIGINS || CLIENT_ORIGIN);

// Validate MONGO_URI on startup to prevent silent synchronous crashes
if (!process.env.MONGO_URI) {
  console.error("======================================================================");
  console.error("CRITICAL ERROR: MONGO_URI is not defined in the environment variables!");
  console.error("Please configure MONGO_URI in your Render / AWS / Local environment.");
  console.error("======================================================================");
  process.exit(1);
}

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB Connected"))
  .catch(err => {
    console.error("MongoDB Connection Failed:", err);
  });

const app = express();
app.use(helmet({ crossOriginResourcePolicy: false }));
app.set('trust proxy', 1);
app.use(cors({ origin: allowedOrigins === '*' ? true : allowedOrigins, credentials: true }));
app.use(mongoSanitize());
// allow larger payloads for image uploads (base64 data URLs)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

app.get('/api/health', (req, res) => {
  res.status(200).json({ ok: true, uptime: process.uptime() });
});

app.use("/api/auth", require("./routes/auth"));
app.use("/api/users", require("./routes/users"));
app.use("/api/groups", require("./routes/groups"));
// new messages routes for fetching history and marking seen
app.use("/api/messages", require("./routes/messages"));
// debug/test routes
app.use("/api/debug", require("./routes/debug"));


const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: allowedOrigins === '*' ? '*' : allowedOrigins },
  maxHttpBufferSize: 50 * 1024 * 1024 // 50MB for large file uploads
});

io.use(socketAuth);

// helper to create a consistent room identifier for two user ids
function getRoom(a, b) { return [a, b].sort().join("_"); }

// track online users: { userId: socketId }
const onlineUsers = {};

async function initializeSocketUser(socket) {
  const user = socket.data.user;
  if (!user?._id) return;

  onlineUsers[String(user._id)] = socket.id;

  const onlineMap = {};
  Object.keys(onlineUsers).forEach(id => { onlineMap[id] = true; });
  socket.emit('onlineList', onlineMap);
  io.emit('userOnline', { userId: String(user._id), isOnline: true, user });

  try {
    const Group = require("./models/Group");
    const userGroups = await Group.find({ members: user._id });
    userGroups.forEach(g => socket.join(g._id.toString()));
  } catch (err) {
    console.error("Error joining groups:", err);
  }
}

io.on("connection", async (socket) => {
  await initializeSocketUser(socket);

  // Backward compatible no-op: identity now comes from JWT auth.
  socket.on("setUserId", async (userId) => {
    if (socket.data.user && String(socket.data.user._id) !== String(userId)) {
      return;
    }
  });

  socket.on("joinRoom", ({ otherUserId }) => {
    const userId = socket.data.user?._id;
    if (!userId || !otherUserId) return;
    const room = getRoom(userId, otherUserId);
    socket.join(room);
  });

  socket.on("joinGroup", (groupId) => {
    if (groupId) socket.join(groupId);
  });

  // Emit a real-time chat request notification
  socket.on("sendChatRequest", async ({ from, to }) => {
    try {
      const User = require("./models/User");
      const senderId = socket.data.user?._id;
      if (!senderId || String(senderId) !== String(from)) return;
      const sender = await User.findById(senderId).select('_id username avatar verified reputation isBlocked');
      const recipientSocketId = onlineUsers[to];
      if (recipientSocketId) {
        io.to(recipientSocketId).emit("chatRequestReceived", { from: sender });
      }
    } catch (err) {
      console.error("Socket error on sendChatRequest", err);
    }
  });

  // Emit real-time notification when a chat request is accepted
  socket.on("chatRequestAccepted", async ({ from, to }) => {
    try {
      const User = require("./models/User");
      const senderId = socket.data.user?._id;
      if (!senderId || String(senderId) !== String(from)) return;
      const accepter = await User.findById(senderId).select('_id username avatar verified reputation isBlocked');
      const recipientSocketId = onlineUsers[to];
      if (recipientSocketId) {
        io.to(recipientSocketId).emit("chatAccepted", { by: accepter });
      }
    } catch (err) {
      console.error("Socket error on chatRequestAccepted", err);
    }
  });

  socket.on("sendMessage", async (data) => {
    try {
      const senderId = socket.data.user?._id;
      const { to, message, media, replyTo, isGroup, forwardedFrom } = data;
      if (!senderId) return;

      if (!isGroup) {
        const User = require("./models/User");
        const recipient = await User.findById(to);
        const sender = await User.findById(senderId);
        if (recipient && recipient.blocked && recipient.blocked.includes(senderId)) {
          return socket.emit("errorMessage", { error: "Message not delivered" });
        }
        if (sender && sender.blocked && sender.blocked.includes(to)) {
          return socket.emit("errorMessage", { error: "You blocked this user." });
        }
        // Gate DMs: both must have accepted each other
        const senderAccepted = sender && sender.acceptedChats && sender.acceptedChats.map(String).includes(String(to));
        const recipientAccepted = recipient && recipient.acceptedChats && recipient.acceptedChats.map(String).includes(String(senderId));
        if (!senderAccepted || !recipientAccepted) {
          const pendingMsg = await Message.create({
            room: getRoom(senderId, to),
            from: senderId,
            to,
            message,
            seen: false,
            isGroup: false,
            isRequest: true,
            requestStatus: 'pending',
            ...(media ? { media } : {}),
            ...(replyTo ? { replyTo } : {}),
            ...(forwardedFrom ? { forwardedFrom, isForwarded: true } : {}),
          });

          await User.findByIdAndUpdate(to, {
            $addToSet: {
              chatRequests: senderId,
            },
            $push: {
              requestHistory: {
                from: senderId,
                status: 'pending',
                requestedAt: new Date(),
                respondedAt: null,
              }
            }
          });

          const recipientSocketId = onlineUsers[to];
          if (recipientSocketId) {
            io.to(recipientSocketId).emit("messageRequestReceived", { from: sender, message: pendingMsg });
          }
          return;
        }
      }

      const room = isGroup ? to : getRoom(senderId, to);
      const msgData = { room, from: senderId, to, message, seen: false, isGroup: isGroup || false, requestStatus: 'accepted' };
      if (media) {
        msgData.media = media;
      }
      if (replyTo) {
        msgData.replyTo = replyTo;
      }
      if (forwardedFrom) {
        msgData.forwardedFrom = forwardedFrom;
        msgData.isForwarded = true;
      }
      let newMsg = await Message.create(msgData);

      if (replyTo) {
        newMsg = await Message.findById(newMsg._id).populate('replyTo', 'message media from _id');
      }

      // emit to the active chat room (so sender and active recipient see it immediately)
      io.to(room).emit("receiveMessage", newMsg);

      // if it's a 1-on-1 message, send background notification
      if (!isGroup) {
        const recipientSocketId = onlineUsers[to];
        if (recipientSocketId) {
          io.to(recipientSocketId).emit("backgroundMessage", newMsg);
        }
      }
    } catch (err) {
      console.error("Socket error on sendMessage", err);
    }
  });

  socket.on("markSeen", async (id) => {
    try {
      if (!id) return;
      const updatedMsg = await Message.findByIdAndUpdate(id, { seen: true }, { new: true });
      if (updatedMsg && String(updatedMsg.to) === String(socket.data.user?._id)) {
        io.to(updatedMsg.room).emit("messageSeen", updatedMsg._id);
      }
    } catch (err) {
      console.error("Socket error on markSeen", err);
    }
  });

  socket.on("editMessage", async ({ id, newText }) => {
    try {
      if (!id || !newText) return;
      const updatedMsg = await Message.findByIdAndUpdate(id, { message: newText, isEdited: true }, { new: true });
      if (updatedMsg && String(updatedMsg.from) === String(socket.data.user?._id)) {
        io.to(updatedMsg.room).emit("messageEdited", updatedMsg);
      }
    } catch (err) {
      console.error("Socket error on editMessage", err);
    }
  });

  socket.on("deleteMessage", async ({ id, type, userId }) => {
    try {
      const senderId = socket.data.user?._id;
      if (!id || !senderId) return;
      if (userId && String(userId) !== String(senderId)) return;
      if (type === 'everyone') {
        const deletedMsg = await Message.findByIdAndDelete(id);
        if (deletedMsg && String(deletedMsg.from) === String(senderId)) {
          io.to(deletedMsg.room).emit("messageDeleted", { id, room: deletedMsg.room, type: 'everyone' });
        }
      } else {
        const updatedMsg = await Message.findByIdAndUpdate(id, { $addToSet: { deletedBy: senderId } }, { new: true });
        if (updatedMsg) {
          io.to(updatedMsg.room).emit("messageDeleted", { id, room: updatedMsg.room, type: 'me', userId: senderId });
        }
      }
    } catch (err) {
      console.error("Socket error on deleteMessage", err);
    }
  });

  socket.on("clearChat", async ({ room, type, userId }) => {
    try {
      const senderId = socket.data.user?._id;
      if (!room || !senderId) return;
      if (userId && String(userId) !== String(senderId)) return;
      if (type === 'everyone') {
        await Message.deleteMany({ room });
        io.to(room).emit("chatCleared", { room, type: 'everyone' });
      } else {
        await Message.updateMany({ room }, { $addToSet: { deletedBy: senderId } });
        io.to(room).emit("chatCleared", { room, type: 'me', userId: senderId });
      }
    } catch (err) {
      console.error("Socket error on clearChat", err);
    }
  });

  socket.on("messageReaction", async ({ id, emoji, userId, username }) => {
    try {
      if (!id || !emoji || !userId || !username) return;
      const msg = await Message.findById(id);
      if (!msg) return;

      if (!msg.reactions) {
        msg.reactions = [];
      }

      const existingReactionIndex = msg.reactions.findIndex(
        r => String(r.userId) === String(userId) && r.emoji === emoji
      );

      if (existingReactionIndex !== -1) {
        msg.reactions.splice(existingReactionIndex, 1);
      } else {
        const userPrevReactionIndex = msg.reactions.findIndex(
          r => String(r.userId) === String(userId)
        );
        if (userPrevReactionIndex !== -1) {
          msg.reactions.splice(userPrevReactionIndex, 1);
        }
        msg.reactions.push({ userId, username, emoji });
      }

      await msg.save();
      io.to(msg.room).emit("messageReactionUpdated", { id, reactions: msg.reactions });
    } catch (err) {
      console.error("Socket error on messageReaction", err);
    }
  });

  socket.on("markAllSeen", ({ userId, otherUserId }) => {
    const senderId = socket.data.user?._id;
    if (!senderId || String(senderId) !== String(userId)) return;
    const room = getRoom(senderId, otherUserId);
    // emit to everyone else in the room (the sender whose messages were just seen)
    socket.to(room).emit("allMessagesSeen", { viewerId: userId });
  });

  socket.on("typing", ({ from, to }) => {
    const senderId = socket.data.user?._id;
    if (!senderId || String(senderId) !== String(from)) return;
    const room = getRoom(senderId, to);
    // broadcast typing status to the room (which includes the recipient)
    socket.to(room).emit("typing", { from: senderId });
  });

  socket.on("stopTyping", ({ from, to }) => {
    const senderId = socket.data.user?._id;
    if (!senderId || String(senderId) !== String(from)) return;
    const room = getRoom(senderId, to);
    socket.to(room).emit("stopTyping", { from: senderId });
  });

  socket.on("disconnect", () => {
    // find and remove this user from onlineUsers
    const userId = socket.data.user?._id;
    if (userId && onlineUsers[String(userId)] === socket.id) {
      delete onlineUsers[String(userId)];
      io.emit("userOffline", { userId: String(userId), isOnline: false });
    }
  });

});

server.listen(PORT, () => {
  console.log("Server running on", PORT);
});
