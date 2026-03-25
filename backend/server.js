
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const cors = require("cors");
const Message = require("./models/Message");

dotenv.config();
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB Connected"))
  .catch(err => console.log(err));

const app = express();
app.use(cors());
// allow larger payloads for image uploads (base64 data URLs)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

app.use("/api/auth", require("./routes/auth"));
app.use("/api/users", require("./routes/users"));
app.use("/api/groups", require("./routes/groups"));
// new messages routes for fetching history and marking seen
app.use("/api/messages", require("./routes/messages"));


const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
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

  socket.on("sendMessage", async (data) => {
    try {
      const { from, to, message, media, replyTo, isGroup } = data;
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
      await Message.findByIdAndUpdate(id, { seen: true });
    } catch (err) {
      console.error("Socket error on markSeen", err);
    }
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

server.listen(process.env.PORT, () => {
  console.log("Server running on", process.env.PORT);
});
// Trigger restart
