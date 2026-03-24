
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
  });

  socket.on("joinRoom", ({ userId, otherUserId }) => {
    const room = getRoom(userId, otherUserId);
    socket.join(room);
  });

  socket.on("sendMessage", async (data) => {
    try {
      const { from, to, message, media } = data;
      const room = getRoom(from, to);
      const msgData = { room, from, to, message, seen: false };
      if (media) {
        msgData.media = media;
      }
      const newMsg = await Message.create(msgData);

      // emit to the active chat room (so sender and active recipient see it immediately)
      io.to(room).emit("receiveMessage", newMsg);

      // if the recipient is online but not currently in this specific chat room, 
      // they still need the background 'receiveMessage' event to tick up their badge count.
      // we emit directly to their Socket ID.
      const recipientSocketId = onlineUsers[to];
      if (recipientSocketId) {
        // use a special event or just emit the same one directly to their root socket
        io.to(recipientSocketId).emit("backgroundMessage", newMsg);
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
