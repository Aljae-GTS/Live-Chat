const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Create HTTP server and attach Socket.io
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // In production, replace with your frontend URL
    methods: ["GET", "POST"],
  },
});

// Store connected users { socketId: username }
const connectedUsers = {};

// REST endpoint to verify server is running
app.get("/", (req, res) => {
  res.json({ message: "Chat server is running", users: Object.values(connectedUsers) });
});

// Socket.io connection handler
io.on("connection", (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  // Event: user joins with a username
  socket.on("user_join", (username) => {
    connectedUsers[socket.id] = username;
    console.log(`${username} joined the chat`);

    // Notify everyone that a user joined
    io.emit("user_joined", {
      username,
      message: `${username} joined the chat`,
      timestamp: new Date().toISOString(),
      type: "system",
      users: Object.values(connectedUsers),
    });
  });

  // Event: user sends a message
  socket.on("send_message", (data) => {
    const username = connectedUsers[socket.id] || "Anonymous";
    const messagePayload = {
      id: Date.now(),
      username,
      message: data.message,
      timestamp: new Date().toISOString(),
      type: "chat",
    };

    console.log(`Message from ${username}: ${data.message}`);
    // Broadcast to ALL connected clients (including sender)
    io.emit("receive_message", messagePayload);
  });

  // Event: user is typing
  socket.on("typing", (isTyping) => {
    const username = connectedUsers[socket.id];
    if (username) {
      // Broadcast to everyone EXCEPT the sender
      socket.broadcast.emit("user_typing", { username, isTyping });
    }
  });

  // Event: user disconnects
  socket.on("disconnect", () => {
    const username = connectedUsers[socket.id];
    if (username) {
      delete connectedUsers[socket.id];
      console.log(`${username} disconnected`);

      io.emit("user_left", {
        username,
        message: `${username} left the chat`,
        timestamp: new Date().toISOString(),
        type: "system",
        users: Object.values(connectedUsers),
      });
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
