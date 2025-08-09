// utils/socket.ts
import { io, type Socket } from "socket.io-client";

let socket: Socket;

if (typeof window !== "undefined") {
  const URL =
    process.env.NEXT_PUBLIC_SOCKET_URL ?? window.location.origin;

  socket = io(URL, {
    path: process.env.NEXT_PUBLIC_SOCKET_PATH ?? "/socket.io",
    transports: ["websocket", "polling"],
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    // withCredentials: false, // omit unless you enable credentials on the server
  });
}

export default socket!;
