
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const cors = require("cors");
const Message = require("./models/Message");

dotenv.config();
const PORT = process.env.PORT || 5000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "*";

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB Connected"))
  .catch(err => console.log(err));

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN === "*" ? true : CLIENT_ORIGIN }));
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


const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CLIENT_ORIGIN === "*" ? "*" : CLIENT_ORIGIN },
  maxHttpBufferSize: 50 * 1024 * 1024 // 50MB for large file uploads
});

// helper to create a consistent room identifier for two user ids
function getRoom(a, b) { return [a, b].sort().join("_"); }

// track online users: { userId: socketId }
const onlineUsers = {};

io.on("connection", (socket) => {
  // when a user connects, they emit their userId
  socket.on("setUserId", async (userId) => {
    onlineUsers[userId] = socket.id;

    // fetch the user's details to broadcast to live clients
    try {
      const User = require("./models/User");
      const user = await User.findById(userId).select("_id username avatar");
      // broadcast online status with full profile to attach them to sidebars dynamically
      io.emit("userOnline", { userId, isOnline: true, user });
    } catch (err) {
      console.error("Error fetching user on connect:", err);
      io.emit("userOnline", { userId, isOnline: true });
    }

    // send current online list to the newly connected socket so it can initialize
    const onlineMap = {};
    Object.keys(onlineUsers).forEach(id => { onlineMap[id] = true; });
    socket.emit('onlineList', onlineMap);
    
    // Join all group rooms
    try {
      const Group = require("./models/Group");
      const userGroups = await Group.find({ members: userId });
      userGroups.forEach(g => socket.join(g._id.toString()));
    } catch (err) {
      console.error("Error joining groups:", err);
    }
  });

  socket.on("joinRoom", ({ userId, otherUserId }) => {
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
      const sender = await User.findById(from).select('_id username avatar');
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
      const accepter = await User.findById(from).select('_id username avatar');
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
      const { from, to, message, media, replyTo, isGroup } = data;

      if (!isGroup) {
        const User = require("./models/User");
        const recipient = await User.findById(to);
        const sender = await User.findById(from);
        if (recipient && recipient.blocked && recipient.blocked.includes(from)) {
          return socket.emit("errorMessage", { error: "Message not delivered" });
        }
        if (sender && sender.blocked && sender.blocked.includes(to)) {
          return socket.emit("errorMessage", { error: "You blocked this user." });
        }
        // Gate DMs: both must have accepted each other
        const senderAccepted = sender && sender.acceptedChats && sender.acceptedChats.map(String).includes(String(to));
        const recipientAccepted = recipient && recipient.acceptedChats && recipient.acceptedChats.map(String).includes(String(from));
        if (!senderAccepted || !recipientAccepted) {
          return socket.emit("errorMessage", { error: "Chat not accepted yet. Send a chat request first." });
        }
      }

      const room = isGroup ? to : getRoom(from, to);
      const msgData = { room, from, to, message, seen: false, isGroup: isGroup || false };
      if (media) {
        msgData.media = media;
      }
      if (replyTo) {
        msgData.replyTo = replyTo;
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
      if (updatedMsg) {
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
      if (updatedMsg) {
        io.to(updatedMsg.room).emit("messageEdited", updatedMsg);
      }
    } catch (err) {
      console.error("Socket error on editMessage", err);
    }
  });

  socket.on("deleteMessage", async ({ id, type, userId }) => {
    try {
      if (!id || !userId) return;
      if (type === 'everyone') {
        const deletedMsg = await Message.findByIdAndDelete(id);
        if (deletedMsg) {
          io.to(deletedMsg.room).emit("messageDeleted", { id, room: deletedMsg.room, type: 'everyone' });
        }
      } else {
        const updatedMsg = await Message.findByIdAndUpdate(id, { $addToSet: { deletedBy: userId } }, { new: true });
        if (updatedMsg) {
          io.to(updatedMsg.room).emit("messageDeleted", { id, room: updatedMsg.room, type: 'me', userId });
        }
      }
    } catch (err) {
      console.error("Socket error on deleteMessage", err);
    }
  });

  socket.on("clearChat", async ({ room, type, userId }) => {
    try {
      if (!room || !userId) return;
      if (type === 'everyone') {
        await Message.deleteMany({ room });
        io.to(room).emit("chatCleared", { room, type: 'everyone' });
      } else {
        await Message.updateMany({ room }, { $addToSet: { deletedBy: userId } });
        io.to(room).emit("chatCleared", { room, type: 'me', userId });
      }
    } catch (err) {
      console.error("Socket error on clearChat", err);
    }
  });
  socket.on("markAllSeen", ({ userId, otherUserId }) => {
    const room = getRoom(userId, otherUserId);
    // emit to everyone else in the room (the sender whose messages were just seen)
    socket.to(room).emit("allMessagesSeen", { viewerId: userId });
  });

  socket.on("typing", ({ from, to }) => {
    const room = getRoom(from, to);
    // broadcast typing status to the room (which includes the recipient)
    socket.to(room).emit("typing", { from });
  });

  socket.on("stopTyping", ({ from, to }) => {
    const room = getRoom(from, to);
    socket.to(room).emit("stopTyping", { from });
  });

  socket.on("disconnect", () => {
    // find and remove this user from onlineUsers
    for (const userId in onlineUsers) {
      if (onlineUsers[userId] === socket.id) {
        delete onlineUsers[userId];
        // broadcast offline status
        io.emit("userOffline", { userId, isOnline: false });
        break;
      }
    }
  });

});

server.listen(PORT, () => {
  console.log("Server running on", PORT);
});
