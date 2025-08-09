// utils/socket.ts
import { io, Socket } from "socket.io-client";

let socket: Socket;

// only create the socket in the browser
if (typeof window !== "undefined") {
  const URL =
    process.env.NEXT_PUBLIC_SOCKET_URL || window.location.origin; // e.g. https://your-signal.onrender.com

  socket = io(URL, {
    transports: ["websocket"],             // skip long-polling on hosts that support WS
    path: process.env.NEXT_PUBLIC_SOCKET_PATH || "/socket.io",
    withCredentials: true,
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
  });
}

// @ts-ignore - not used during SSR
export default socket!;
