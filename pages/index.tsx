import { useState } from 'react';
import { useRouter } from 'next/router';
import { v4 as uuidv4 } from 'uuid';

export default function Home() {
  const [roomCode, setRoomCode] = useState('');
  const router = useRouter();

  const handleJoinRoom = () => {
    if (roomCode.trim() !== '') {
      router.push(`/room/${roomCode}`);
    }
  };

  const handleCreateRoom = () => {
    const newRoomId = uuidv4();
    router.push(`/room/${newRoomId}`);
  };

  return (
    <div className="min-h-screen flex flex-col justify-center items-center bg-gray-900 text-white relative">
      <h1 className="text-4xl font-bold mb-8">Welcome to Meetup</h1>

      <div className="bg-gray-800 p-6 rounded-lg shadow-lg w-full max-w-md">
        <label className="block text-lg mb-2">Enter Room Code</label>
        <input
          type="text"
          value={roomCode}
          onChange={(e) => setRoomCode(e.target.value)}
          placeholder="Room Code"
          className="w-full px-4 py-2 mb-4 text-black rounded"
        />
        <button
          onClick={handleJoinRoom}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded mb-4"
        >
          Join Room
        </button>
        <hr className="my-4 border-gray-600" />
        <button
          onClick={handleCreateRoom}
          className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded"
        >
          Create New Room
        </button>
      </div>

      <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 text-gray-400 text-sm">
        crafted by{' '}
        <a
          href="https://linktr.ee/_shounakchandra"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-blue-400"
        >
          Shounak
        </a>
      </div>
    </div>
  );
}
