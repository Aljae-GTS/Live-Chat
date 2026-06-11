const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  maxHttpBufferSize: 50 * 1024 * 1024, // 50MB — needed for base64 images
});

const connectedUsers = {};  // socketId -> username
const activeStreams = {};    // socketId -> { socketId, username, title }

app.get("/", (req, res) => {
  res.json({
    message: "LiveChat server running",
    users: Object.values(connectedUsers),
    streams: Object.values(activeStreams),
  });
});

io.on("connection", (socket) => {
  console.log(`Connected: ${socket.id}`);

  // ── JOIN ──────────────────────────────────────────────────────
  socket.on("user_join", (username) => {
    connectedUsers[socket.id] = username;
    io.emit("user_joined", {
      id: Date.now(), username,
      message: `${username} joined the chat`,
      timestamp: new Date().toISOString(),
      type: "system",
      users: Object.values(connectedUsers),
      streams: Object.values(activeStreams), // send current streams to new user
    });
  });

  // ── CHAT MESSAGE (text or image) ─────────────────────────────
  socket.on("send_message", (data) => {
    const username = connectedUsers[socket.id] || "Anonymous";
    // Only emit if there is text OR an image
    if (!data.message && !data.image) return;
    io.emit("receive_message", {
      id: Date.now(),
      username,
      message: data.message || "",
      image: data.image || null,
      imageType: data.imageType || null,
      timestamp: new Date().toISOString(),
      type: "chat",
    });
  });

  // ── TYPING ───────────────────────────────────────────────────
  socket.on("typing", (isTyping) => {
    const username = connectedUsers[socket.id];
    if (username) socket.broadcast.emit("user_typing", { username, isTyping });
  });

  // ── STREAM START ─────────────────────────────────────────────
  socket.on("stream_start", ({ title }) => {
    const username = connectedUsers[socket.id];
    if (!username) return;
    activeStreams[socket.id] = {
      socketId: socket.id,
      username,
      title: title || `${username}'s screen`,
    };
    io.emit("stream_started", {
      id: Date.now(), socketId: socket.id, username,
      title: activeStreams[socket.id].title,
      streams: Object.values(activeStreams),
      type: "system",
      message: `${username} started streaming`,
      timestamp: new Date().toISOString(),
    });
  });

  // ── STREAM STOP ──────────────────────────────────────────────
  socket.on("stream_stop", () => {
    const username = connectedUsers[socket.id];
    if (activeStreams[socket.id]) {
      delete activeStreams[socket.id];
      io.emit("stream_stopped", {
        id: Date.now(), socketId: socket.id, username,
        streams: Object.values(activeStreams),
        type: "system",
        message: `${username} stopped streaming`,
        timestamp: new Date().toISOString(),
      });
    }
  });

  // ── WebRTC SIGNALING ─────────────────────────────────────────
  socket.on("webrtc_offer", ({ offer, viewerSocketId }) => {
    io.to(viewerSocketId).emit("webrtc_offer", { offer, streamerSocketId: socket.id });
  });

  socket.on("webrtc_answer", ({ answer, streamerSocketId }) => {
    io.to(streamerSocketId).emit("webrtc_answer", { answer, viewerSocketId: socket.id });
  });

  socket.on("ice_candidate", ({ candidate, targetSocketId }) => {
    io.to(targetSocketId).emit("ice_candidate", { candidate, fromSocketId: socket.id });
  });

  socket.on("watch_stream", ({ streamerSocketId }) => {
    io.to(streamerSocketId).emit("viewer_joined", { viewerSocketId: socket.id });
  });

  socket.on("stop_watching", ({ streamerSocketId }) => {
    io.to(streamerSocketId).emit("viewer_left", { viewerSocketId: socket.id });
  });

  // ── DISCONNECT ───────────────────────────────────────────────
  socket.on("disconnect", () => {
    const username = connectedUsers[socket.id];
    if (username) {
      delete connectedUsers[socket.id];
      if (activeStreams[socket.id]) delete activeStreams[socket.id];
      io.emit("user_left", {
        id: Date.now(), username,
        message: `${username} left the chat`,
        timestamp: new Date().toISOString(),
        type: "system",
        users: Object.values(connectedUsers),
        streams: Object.values(activeStreams),
      });
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
