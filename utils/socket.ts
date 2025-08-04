import { io } from 'socket.io-client';

const socket = io('http://localhost:4000'); // use your deployed URL later
export default socket;
