import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import socket from '@/utils/socket';

export default function RoomPage() {
  const router = useRouter();
  const { id: roomId } = router.query;

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  const [isConnected, setIsConnected] = useState(false);

  // Configuration with public STUN server
  const iceServers = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' }
    ]
  };

  useEffect(() => {
    if (!roomId) return;

    // Get user media
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then(stream => {
        localStreamRef.current = stream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }

        // Join room
        socket.emit('join-room', roomId);
      })
      .catch(err => {
        console.error('Error accessing media devices.', err);
      });

    // Handle signaling
    socket.on('user-joined', async (userId) => {
      console.log('User joined:', userId);
      await createOffer(userId);
    });

    socket.on('offer', async ({ offer, from }) => {
      await handleReceiveOffer(offer, from);
    });

    socket.on('answer', async ({ answer }) => {
      await peerConnectionRef.current?.setRemoteDescription(new RTCSessionDescription(answer));
    });

    socket.on('ice-candidate', async ({ candidate }) => {
      if (candidate) {
        await peerConnectionRef.current?.addIceCandidate(new RTCIceCandidate(candidate));
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [roomId]);

  const createPeerConnection = (to: string) => {
    const pc = new RTCPeerConnection(iceServers);

    // Add local tracks
    localStreamRef.current?.getTracks().forEach(track => {
      pc.addTrack(track, localStreamRef.current!);
    });

    // Handle remote stream
    pc.ontrack = (event) => {
      const [remoteStream] = event.streams;
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remoteStream;
      }
    };

    // ICE Candidate
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('ice-candidate', { candidate: event.candidate, to });
      }
    };

    peerConnectionRef.current = pc;
  };

  const createOffer = async (to: string) => {
    createPeerConnection(to);
    const offer = await peerConnectionRef.current?.createOffer();
    await peerConnectionRef.current?.setLocalDescription(offer);
    socket.emit('offer', { offer, to });
    setIsConnected(true);
  };

  const handleReceiveOffer = async (offer: RTCSessionDescriptionInit, from: string) => {
    createPeerConnection(from);
    await peerConnectionRef.current?.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnectionRef.current?.createAnswer();
    await peerConnectionRef.current?.setLocalDescription(answer);
    socket.emit('answer', { answer, to: from });
    setIsConnected(true);
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center">
      <h1 className="text-2xl font-bold mb-4">Room: {roomId}</h1>
      <div className="flex flex-col sm:flex-row gap-4 mb-4">
  <div className="border-2 border-blue-500 rounded">
    <p className="text-sm text-center">You</p>
    <video ref={localVideoRef} autoPlay muted playsInline className="w-80 h-60 bg-black rounded" />
  </div>
  <div className="border-2 border-green-500 rounded">
    <p className="text-sm text-center">Peer</p>
    <video ref={remoteVideoRef} autoPlay playsInline className="w-80 h-60 bg-black rounded" />
  </div>
</div>

      <p>{isConnected ? 'Connected to peer' : 'Waiting for peer...'}</p>
    </div>
  );
}
