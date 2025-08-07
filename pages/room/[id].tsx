// pages/room/[id].tsx - FIXED VERSION
import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/router';
import dynamic from 'next/dynamic';
import socket from '@/utils/socket';
import type { EmojiClickData } from 'emoji-picker-react';

const EmojiPicker = dynamic(() => import('emoji-picker-react'), { ssr: false });

type ChatMsg = {
  sender: string;
  message: string;
  type: 'text' | 'image' | 'gif';
  timestamp: number;
};

export default function RoomPage() {
  const router = useRouter();
  const { id: roomId } = router.query as { id: string };

  // WebRTC refs & state
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);

  const [showSettings, setShowSettings] = useState(false);
  const [backgroundImage, setBackgroundImage] = useState<string>('');
  const [textColor, setTextColor] = useState<'black' | 'white'>('black');

  // ICE-candidate queue until remoteDescription is set
  const queuedIceRef = useRef<RTCIceCandidateInit[]>([]);

  // Negotiation state management
  const makingOfferRef = useRef(false);
  const ignoreOfferRef = useRef(false);

  const [isHost, setIsHost] = useState(false);
  const [peerJoined, setPeerJoined] = useState(false);
  const [connectionState, setConnectionState] = useState<RTCPeerConnectionState>('new');
  const [isCallActive, setIsCallActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Media toggle state
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);

  // Name handling - Fixed initialization
  const [userName, setUserName] = useState('');
  const [peerName, setPeerName] = useState('');
  const [roomName, setRoomName] = useState<string>('');

  // Chat state
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [gifQuery, setGifQuery] = useState('');
  const [gifResults, setGifResults] = useState<string[]>([]);

  // Media and dialog state
  const [mediaLoading, setMediaLoading] = useState(true);
  const [showEndDialog, setShowEndDialog] = useState(false);
  const [remoteScreenStream, setRemoteScreenStream] = useState<MediaStream | null>(null);
  const remoteScreenRef = useRef<HTMLVideoElement>(null);
  const [endDialogMessage, setEndDialogMessage] = useState('');
  const [screenSharingActive, setScreenSharingActive] = useState(false);
  const [isSharingLocal, setIsSharingLocal] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [roomError, setRoomError] = useState<string | null>(null);
  const [showPhotoOptions, setShowPhotoOptions] = useState(false);


  const [signalingState, setSignalingState] = useState<RTCSignalingState>('stable');

  const iceServers = { 
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ] 
  };

  // ── Initialize or return existing RTCPeerConnection ─────────────────────────
  const initPeerConnection = useCallback((): RTCPeerConnection => {
    if (peerConnectionRef.current && peerConnectionRef.current.connectionState !== 'closed') {
      return peerConnectionRef.current;
    }

    const pc = new RTCPeerConnection(iceServers);
    peerConnectionRef.current = pc;

    // FIXED: Add local tracks in a consistent order - video first, then audio
    if (localStreamRef.current) {
      const videoTracks = localStreamRef.current.getVideoTracks();
      const audioTracks = localStreamRef.current.getAudioTracks();
      
      // Add video tracks first
      videoTracks.forEach((track) => {
        if (localStreamRef.current) {
          console.log('Adding video track');
          pc.addTrack(track, localStreamRef.current);
        }
      });
      
      // Add audio tracks second
      audioTracks.forEach((track) => {
        if (localStreamRef.current) {
          console.log('Adding audio track');
          pc.addTrack(track, localStreamRef.current);
        }
      });
    }

    pc.ontrack = (event) => {
      console.log('Received remote track:', event.track.kind);
      const [remoteStream] = event.streams;
      
      // Check if this is screen share (video track with specific constraints or label)
      if (event.track.kind === 'video' && remoteStream.getVideoTracks()[0]?.label?.includes('screen')) {
        // This is screen share
        if (remoteScreenRef.current) {
          remoteScreenRef.current.srcObject = remoteStream;
        }
        setRemoteScreenStream(remoteStream);
      } else {
        // This is regular camera feed
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = remoteStream;
        }
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate && roomId) {
        console.log('Sending ICE candidate');
        socket.emit('ice-candidate', { roomId, candidate: event.candidate });
      }
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      console.log('Connection state changed:', state);
      setConnectionState(state);
      
      if (state === 'connected') {
        setIsCallActive(true);
        setError(null);
      } else if (state === 'disconnected') {
        setIsCallActive(false);
      } else if (state === 'failed') {
        setIsCallActive(false);
        setError('Connection failed - attempting to reconnect...');
        // Try to restart ICE
        if (pc.restartIce) {
          pc.restartIce();
        }
      } else if (state === 'closed') {
        setIsCallActive(false);
      }
    };

    pc.onsignalingstatechange = () => {
      const state = pc.signalingState;
      console.log('Signaling state changed:', state);
      setSignalingState(state);
    };

    pc.onicegatheringstatechange = () => {
      console.log('ICE gathering state:', pc.iceGatheringState);
    };

    return pc;
  }, [roomId]);

  // ── Reset PeerConnection (keep local video) ─────────────────────────────────
  const resetPeerConnection = useCallback(() => {
    console.log('Resetting peer connection');
    
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    
    queuedIceRef.current = [];
    makingOfferRef.current = false;
    ignoreOfferRef.current = false;
    setPeerJoined(false);
    setConnectionState('new');
    setSignalingState('stable');
    setIsCallActive(false);
    
    // Clear remote video
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
  }, []);

  // ── Create & send offer (host) ─────────────────────────────────────────────
  const createOffer = useCallback(async () => {
    if (!roomId || !localStreamRef.current || !isHost) {
      console.log('Cannot create offer: missing requirements');
      return;
    }

    try {
      // FIXED: Always create a fresh peer connection for offers
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
        peerConnectionRef.current = null;
      }
      
      const pc = initPeerConnection();
      
      if (pc.signalingState !== 'stable') {
        console.log(`Cannot create offer, signaling state is: ${pc.signalingState}`);
        return;
      }
      
      console.log('Creating offer...');
      makingOfferRef.current = true;
      
      const offer = await pc.createOffer({ 
        offerToReceiveAudio: true, 
        offerToReceiveVideo: true 
      });
      
      if (pc.signalingState !== 'stable') {
        console.log(`Cannot set local description, signaling state changed to: ${pc.signalingState}`);
        return;
      }
      
      await pc.setLocalDescription(offer);
      socket.emit('offer', { roomId, offer });
      console.log('Offer sent');
    } catch (error) {
      console.error('Error creating offer:', error);
      setError('Failed to create offer');
    } finally {
      makingOfferRef.current = false;
    }
  }, [roomId, isHost, initPeerConnection]);

  // ── Handle incoming offer and send answer ──────────────────────────────────
  const createAnswer = useCallback(async (offer: RTCSessionDescriptionInit) => {
    if (!roomId || !localStreamRef.current) {
      console.error('Cannot create answer: missing roomId or localStream');
      return;
    }

    if (!offer || !offer.type || !offer.sdp) {
      console.error('Invalid offer received:', offer);
      setError('Received invalid connection offer');
      return;
    }

    try {
      // FIXED: Create fresh peer connection for answers too
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
        peerConnectionRef.current = null;
      }
      
      const pc = initPeerConnection();
      
      console.log('Current signaling state:', pc.signalingState);
      console.log('Is making offer:', makingOfferRef.current);
      
      // Perfect negotiation pattern
      const isOfferer = pc.signalingState === 'have-local-offer';
      const offerCollision = offer.type === 'offer' && (makingOfferRef.current || isOfferer);
      
      ignoreOfferRef.current = !isHost && offerCollision;
      if (ignoreOfferRef.current) {
        console.log('Ignoring offer due to collision');
        return;
      }

      if (offerCollision) {
        console.log('Offer collision detected, rolling back');
        await pc.setLocalDescription({ type: 'rollback' } as RTCSessionDescriptionInit);
      }
      
      console.log('Setting remote description with offer...');
      await pc.setRemoteDescription(offer);

      // Process queued ICE candidates
      const queuedCandidates = [...queuedIceRef.current];
      queuedIceRef.current = [];
      
      for (const candidate of queuedCandidates) {
        try {
          await pc.addIceCandidate(candidate);
          console.log('Added queued ICE candidate');
        } catch (error) {
          console.error('Error adding queued ICE candidate:', error);
        }
      }

      if (offer.type === 'offer') {
        console.log('Creating answer...');
        await pc.setLocalDescription();
        socket.emit('answer', { roomId, answer: pc.localDescription });
        console.log('Answer sent');
      }
    } catch (error) {
      console.error('Error creating answer:', error);
      setError('Failed to create answer');
    }
  }, [roomId, initPeerConnection, isHost]);

  // ── Handle incoming answer ─────────────────────────────────────────────────
  const handleAnswer = useCallback(async (answer: RTCSessionDescriptionInit) => {
    if (!answer || !answer.type || !answer.sdp) {
      console.error('Invalid answer received:', answer);
      setError('Received invalid connection answer');
      return;
    }

    try {
      const pc = peerConnectionRef.current;
      if (!pc) {
        console.error('No peer connection available for answer');
        return;
      }

      console.log('Current signaling state for answer:', pc.signalingState);
      
      if (pc.signalingState !== 'have-local-offer') {
        console.log(`Cannot handle answer, signaling state is: ${pc.signalingState}`);
        return;
      }

      console.log('Setting remote description with answer...');
      await pc.setRemoteDescription(answer);

      // Process queued ICE candidates
      const queuedCandidates = [...queuedIceRef.current];
      queuedIceRef.current = [];
      
      for (const candidate of queuedCandidates) {
        try {
          await pc.addIceCandidate(candidate);
          console.log('Added queued ICE candidate');
        } catch (error) {
          console.error('Error adding queued ICE candidate:', error);
        }
      }
      
      console.log('Answer processed successfully');
    } catch (error) {
      console.error('Error handling answer:', error);
      setError('Failed to process answer');
    }
  }, []);

  // ── Handle ICE candidate ───────────────────────────────────────────────────
  const handleIceCandidate = useCallback(async (candidate: RTCIceCandidateInit) => {
    if (!candidate) {
      console.error('Invalid ICE candidate received:', candidate);
      return;
    }

    const pc = peerConnectionRef.current;
    
    if (pc && pc.remoteDescription && pc.remoteDescription.type) {
      try {
        await pc.addIceCandidate(candidate);
        console.log('Added ICE candidate');
      } catch (error) {
        if (!ignoreOfferRef.current) {
          console.error('Error adding ICE candidate:', error);
        }
      }
    } else {
      console.log('Queueing ICE candidate (no remote description yet)');
      queuedIceRef.current.push(candidate);
    }
  }, []);

  const handleBackgroundUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !roomId) return;

    try {
      // Upload the image to get a URL
      const formData = new FormData();
      formData.append('file', file);
      
      const response = await fetch('/api/upload', { 
        method: 'POST', 
        body: formData 
      });
      const { url, error } = await response.json();
      
      if (url) {
        // Set local background
        setBackgroundImage(url);
        
        // Sync with peer
        socket.emit('background-sync', { roomId, backgroundUrl: url });
        
        // Auto-adjust text color
        const img = new Image();
        img.src = url;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(img, 0, 0);
          const data = ctx.getImageData(0, 0, img.width, img.height).data;
          let sum = 0;
          for (let i = 0; i < data.length; i += 4) {
            sum += (data[i] + data[i+1] + data[i+2]) / 3;
          }
          const avg = sum / (data.length / 4);
          setTextColor(avg > 128 ? 'black' : 'white');
        };
      } else if (error) {
        setError(`Upload failed: ${error}`);
      }
    } catch (error) {
      console.error('Background upload error:', error);
      setError('Failed to upload background image');
    } finally {
      e.target.value = '';
    }
  };

  // ── End meeting dialog with countdown ──────────────────────────────────────
  const showEndMeetingDialog = useCallback((endedByName: string) => {
    setEndDialogMessage(`Meeting has been ended by ${endedByName}`);
    setShowEndDialog(true);
    setCountdown(5);
    
    const countdownInterval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(countdownInterval);
          router.push('/');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    
    return () => clearInterval(countdownInterval);
  }, [router]);

  // ── Copy room ID to clipboard ──────────────────────────────────────────────
  const copyRoomId = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(roomId);
      const originalError = error;
      setError('Room ID copied to clipboard!');
      setTimeout(() => setError(originalError), 2000);
    } catch (error) {
      console.error('Failed to copy room ID:', error);
      setError('Failed to copy room ID');
    }
  }, [roomId, error]);

  // ── Prompt for user name ────────────────────────────────────────────────────
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const name = (window.prompt('Enter your name') || 'Anonymous').trim();
      setUserName(name);
    }
  }, []);

  // ── Broadcast our name to peer ─────────────────────────────────────────────
  useEffect(() => {
    if (userName && roomId) {
      socket.emit('set-name', { roomId, name: userName });
      
      const timeoutId = setTimeout(() => {
        socket.emit('set-name', { roomId, name: userName });
      }, 1000);
      
      return () => clearTimeout(timeoutId);
    }
  }, [userName, roomId]);

  // ── Chat helpers ────────────────────────────────────────────────────────────
  const appendMessage = useCallback((msg: ChatMsg) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  const sendText = useCallback(() => {
    if (!chatInput.trim() || !roomId) return;
    
    const message: ChatMsg = {
      sender: socket.id || userName,
      message: chatInput,
      type: 'text',
      timestamp: Date.now()
    };
    
    socket.emit('chat-message', { roomId, ...message });
    appendMessage(message);
    setChatInput('');
    setShowEmojiPicker(false);
  }, [chatInput, roomId, userName, appendMessage]);

  const onEmojiClick = useCallback((emojiData: EmojiClickData) => {
    setChatInput((prev) => prev + emojiData.emoji);
  }, []);

  const sendImage = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !roomId) return;
    
    const formData = new FormData();
    formData.append('file', file);
    
    try {
      const response = await fetch('/api/upload', { 
        method: 'POST', 
        body: formData 
      });
      const { url, error } = await response.json();
      
      if (url) {
        const message: ChatMsg = {
          sender: socket.id || userName,
          message: url,
          type: 'image',
          timestamp: Date.now()
        };
        socket.emit('chat-message', { roomId, ...message });
        appendMessage(message);
      } else if (error) {
        setError(`Upload failed: ${error}`);
      }
    } catch (error) {
      console.error('Upload error:', error);
      setError('Failed to upload image');
    } finally {
      e.target.value = '';
    }
  }, [roomId, userName, appendMessage]);

  // ── Fetch Giphy GIFs ────────────────────────────────────────────────────────
  const fetchGiphyGifs = useCallback(async () => {
    try {
      const apiKey = process.env.NEXT_PUBLIC_GIPHY_API_KEY;
      if (!apiKey) {
        setError('Giphy API key not configured');
        return;
      }

      const query = gifQuery.trim();
      const apiUrl = query
        ? `https://api.giphy.com/v1/gifs/search?api_key=${apiKey}&q=${encodeURIComponent(query)}&limit=16&rating=g`
        : `https://api.giphy.com/v1/gifs/trending?api_key=${apiKey}&limit=16&rating=g`;
      
      const response = await fetch(apiUrl);
      const { data } = await response.json();
      
      setGifResults(data.map((gif: any) => gif.images.fixed_width.url));
    } catch (error) {
      console.error('Giphy error:', error);
      setGifResults([]);
      setError('Failed to fetch GIFs');
    }
  }, [gifQuery]);

  const sendGif = useCallback((url: string) => {
    if (!roomId) return;
    
    const message: ChatMsg = {
      sender: socket.id || userName,
      message: url,
      type: 'gif',
      timestamp: Date.now()
    };
    
    socket.emit('chat-message', { roomId, ...message });
    appendMessage(message);
    setShowGifPicker(false);
    setGifQuery('');
    setGifResults([]);
  }, [roomId, userName, appendMessage]);

  // ── When a second peer joins, host sends offer ─────────────────────────────
  const handlePeerJoined = useCallback(() => {
    console.log('Peer joined');
    setPeerJoined(true);
    
    // Only host should initiate after both peers are ready
    if (isHost && localStreamRef.current) {
      socket.emit('set-name', { roomId, name: userName });
      setTimeout(() => {
        createOffer();
      }, 1000);
    }
  }, [isHost, createOffer, roomId, userName]);

  // ── Get local media first ──────────────────────────────────────────────────
  useEffect(() => {
    if (!roomId) return;

    const initializeMedia = async () => {
      try {
        setMediaLoading(true);
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: { 
            width: { ideal: 640 }, 
            height: { ideal: 480 },
            facingMode: 'user'
          }, 
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });
        
        localStreamRef.current = stream;
        
        console.log('Local media initialized', stream.getTracks().map(t => ({
          kind: t.kind,
          enabled: t.enabled,
          readyState: t.readyState
        })));
        
        setTimeout(() => {
          if (localVideoRef.current && stream) {
            localVideoRef.current.srcObject = stream;
            localVideoRef.current.muted = true;
            localVideoRef.current.play().then(() => {
              console.log('Local video playing successfully');
            }).catch(error => {
              console.error('Failed to play local video:', error);
            });
          }
        }, 100);
        
        setMediaLoading(false);
      } catch (error) {
        console.error('Error accessing media devices:', error);
        setError('Failed to access camera/microphone');
        setMediaLoading(false);
      }
    };

    initializeMedia();

    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, [roomId]);

  // ── Socket event listeners ─────────────────────────────────────────────────
  useEffect(() => {
    if (!roomId || mediaLoading || !userName) return;

    console.log('Setting up socket listeners for room:', roomId);

    const handlePeerLeft = () => {
      console.log('Peer left');
      resetPeerConnection();
      setPeerJoined(false);
      setPeerName('');
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = null;
      }
    };

    const handleHostLeft = () => {
      showEndMeetingDialog('Host');
    };

    const handleMeetingEnded = ({ endedBy }: { endedBy: string }) => {
      showEndMeetingDialog(endedBy);
    };

    const handleRoomFull = () => {
      console.log('🚨 DEBUG: room-full event received!');
      setRoomError('Room is full. Only 2 participants are allowed.');
      setTimeout(() => {
        console.log('🚨 DEBUG: Redirecting to home page after room full');
        router.push('/');
      }, 3000);
    };

    const handleInvalidRoom = () => {
      setRoomError('Invalid or expired room ID. Please create a new room.');
      setTimeout(() => router.push('/'), 3000);
    };

    const handlePeerName = ({ name, senderId }: { name: string; senderId: string }) => {
      console.log('Received peer name:', name, 'from:', senderId);
      // Only set peer name if it's not from ourselves
      if (senderId !== socket.id) {
        setPeerName(name);
      }
    };

    const handleChatMessage = (msg: ChatMsg) => {
      if (msg.sender !== socket.id) {
        appendMessage(msg);
      }
    };

    const handleError = (error: string) => {
      console.error('Socket error:', error);
      setError(error);
    };

    const handleBackgroundSync = ({ backgroundUrl }: { backgroundUrl: string }) => {
      console.log('Received background sync:', backgroundUrl);
      setBackgroundImage(backgroundUrl);
      
      // Auto-adjust text color for synced background
      if (backgroundUrl) {
        const img = new Image();
        img.src = backgroundUrl;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(img, 0, 0);
          const data = ctx.getImageData(0, 0, img.width, img.height).data;
          let sum = 0;
          for (let i = 0; i < data.length; i += 4) {
            sum += (data[i] + data[i+1] + data[i+2]) / 3;
          }
          const avg = sum / (data.length / 4);
          setTextColor(avg > 128 ? 'black' : 'white');
        };
      }
    };

    // Set initial values
    setRemoteScreenStream(null);
    if (remoteScreenRef.current) {
      remoteScreenRef.current.srcObject = null;
    }

    // Register listeners
    socket.on('peer-joined', handlePeerJoined);
    socket.on('offer', createAnswer);
    socket.on('answer', handleAnswer);
    socket.on('ice-candidate', handleIceCandidate);
    socket.on('host-left', handleHostLeft);
    socket.on('peer-left', handlePeerLeft);
    socket.on('screen-share-started', () => setScreenSharingActive(true));
    socket.on('screen-share-stopped', () => setScreenSharingActive(false));
    socket.on('room-name', ({ roomName }: { roomName: string }) => { setRoomName(roomName);});
    socket.on('meeting-ended', handleMeetingEnded);
    socket.on('room-full', handleRoomFull);
    socket.on('invalid-room', handleInvalidRoom);
    socket.on('peer-name', handlePeerName);
    socket.on('chat-message', handleChatMessage);
    socket.on('error', handleError);
    socket.on('background-sync', handleBackgroundSync);

    // Join room and check host status
    socket.emit('join-room', roomId);
    socket.emit('check-host', roomId, (hostStatus: boolean) => {
      setIsHost(hostStatus);

      if (hostStatus && !roomName) {
        // ask host for a room name
        const raw = window.prompt('Enter a name for this room')?.trim();
        const finalName = raw && raw.length
          ? raw
          : `${userName}'s room`;
        setRoomName(finalName);
        // tell the other peer
        socket.emit('room-name', { roomId, roomName: finalName });
      }

      if (userName) {
        setTimeout(() => {
          socket.emit('set-name', { roomId, name: userName });
        }, 100);
      }
    });

    return () => {
      console.log('Cleaning up socket listeners');
      socket.off('peer-joined', handlePeerJoined);
      socket.off('offer', createAnswer);
      socket.off('answer', handleAnswer);
      socket.off('ice-candidate', handleIceCandidate);
      socket.off('host-left', handleHostLeft);
      socket.off('peer-left', handlePeerLeft);
      socket.off('screen-share-started');
      socket.off('screen-share-stopped');
      socket.off('room-name');
      socket.off('meeting-ended', handleMeetingEnded);
      socket.off('room-full', handleRoomFull);
      socket.off('invalid-room', handleInvalidRoom);
      socket.off('peer-name', handlePeerName);
      socket.off('chat-message', handleChatMessage);
      socket.off('error', handleError);
      socket.off('background-sync', handleBackgroundSync);
    };
  }, [
    roomId,
    mediaLoading,
    userName,
    handlePeerJoined,
    createAnswer,
    handleAnswer,
    handleIceCandidate,
    resetPeerConnection,
    appendMessage,
    showEndMeetingDialog,
    router,
    roomName
  ]);

  // ── Fetch trending GIFs when picker opens ───────────────────────────────────
  useEffect(() => {
    if (showGifPicker) {
      fetchGiphyGifs();
    }
  }, [showGifPicker, fetchGiphyGifs]);

  // ── Media control functions ────────────────────────────────────────────────
  const toggleAudio = useCallback(() => {
    if (localStreamRef.current) {
      const audioTracks = localStreamRef.current.getAudioTracks();
      audioTracks.forEach(track => {
        track.enabled = !track.enabled;
        console.log('Audio track enabled:', track.enabled);
      });
      setAudioEnabled(prev => !prev);
    }
  }, []);

  const toggleVideo = useCallback(() => {
    if (localStreamRef.current) {
      const videoTracks = localStreamRef.current.getVideoTracks();
      videoTracks.forEach(track => {
        track.enabled = !track.enabled;
        console.log('Video track enabled:', track.enabled);
      });
      setVideoEnabled(prev => !prev);
      
      if (localVideoRef.current && localStreamRef.current) {
        const currentTime = localVideoRef.current.currentTime;
        localVideoRef.current.srcObject = null;
        setTimeout(() => {
          if (localVideoRef.current && localStreamRef.current) {
            localVideoRef.current.srcObject = localStreamRef.current;
            localVideoRef.current.currentTime = currentTime;
          }
        }, 10);
      }
    }
  }, []);

  // ── Screen share (video + system audio) ───────────────────────────────────
  const shareScreen = useCallback(async () => {
    const pc = peerConnectionRef.current;
    if (!pc) return;
    try {
      // ask for display + system audio
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true
      });
      screenStreamRef.current = screenStream;

      setScreenSharingActive(true);
      setIsSharingLocal(true);
      socket.emit('screen-share-started', roomId);

      // replace outgoing video
      const videoSender = pc.getSenders().find(s => s.track?.kind === 'video');
      if (videoSender) {
        const screenTrack = screenStream.getVideoTracks()[0];
        await videoSender.replaceTrack(screenTrack);
        screenTrack.onended = async () => {
          setScreenSharingActive(false);
          setIsSharingLocal(false);
          socket.emit('screen-share-stopped', roomId);
          const camTrack = localStreamRef.current!.getVideoTracks()[0];
          await videoSender.replaceTrack(camTrack);
        };
      }

      // replace outgoing audio, if any
      const sysAudio = screenStream.getAudioTracks()[0];
      if (sysAudio) {
        const audioSender = pc.getSenders().find(s => s.track?.kind === 'audio');
        if (audioSender) await audioSender.replaceTrack(sysAudio);
      }
    } catch (err) {
      console.error('Screen share error:', err);
      setError('Screen share failed: ' + (err as Error).message);
    }
  }, [roomId]);

  // ── stop screen share ──────────────────────────────────────────────────────
  const stopScreenShare = useCallback(async () => {
    const pc = peerConnectionRef.current;
    const screenStream = screenStreamRef.current;
    if (!pc || !screenStream) return;

    // stop all screen tracks
    screenStream.getTracks().forEach(t => t.stop());
    screenStreamRef.current = null;

    // revert video back to camera
    const videoSender = pc.getSenders().find(s => s.track?.kind === 'video');
    if (videoSender && localStreamRef.current) {
      const camTrack = localStreamRef.current.getVideoTracks()[0];
      await videoSender.replaceTrack(camTrack);
    }

    // update state & notify peer
    setScreenSharingActive(false);
    setIsSharingLocal(false);
    socket.emit('screen-share-stopped', roomId);
  }, [roomId]);

  // ── End call ────────────────────────────────────────────────────────────────
  const handleEndCall = useCallback(() => {
    if (roomId && userName) {
      socket.emit('end-meeting', { roomId, endedBy: userName });
    }
    
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
    }
    
    resetPeerConnection();
    router.push('/');
  }, [roomId, userName, resetPeerConnection, router]);

  // Show room error (invalid/expired room or room full)
  if (roomError) {
    return (
      <div style={{ 
        display: 'flex', 
        flexDirection: 'column',
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh',
        backgroundColor: '#f8f9fa',
        padding: 20
      }}>
        <div style={{
          backgroundColor: 'white',
          padding: 40,
          borderRadius: 10,
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          textAlign: 'center',
          maxWidth: 500
        }}>
          <div style={{ fontSize: 48, marginBottom: 20 }}>⚠️</div>
          <h2 style={{ color: '#dc3545', marginBottom: 20 }}>Room Access Error</h2>
          <p style={{ fontSize: 16, marginBottom: 20, lineHeight: 1.5 }}>
            {roomError}
          </p>
          <p style={{ color: '#6c757d', fontSize: 14 }}>
            Redirecting to home page in a few seconds...
          </p>
        </div>
      </div>
    );
  }

  // Show loading state
  if (mediaLoading) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh' 
      }}>
        <div>Loading camera and microphone...</div>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        backgroundImage: backgroundImage ? `url(${backgroundImage})` : undefined,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        color: textColor,
      }}
    >
      {/* Video + Controls */}
      <div style={{ flex: 1, padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <h1 style={{ margin: 0 }}>{roomName ? roomName : `Room: ${roomId}`}</h1>
          <button 
            onClick={copyRoomId}
            style={{ 
              backgroundColor: '#17a2b8', 
              color: 'white', 
              border: 'none', 
              padding: '6px 12px',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 'bold'
            }}
            title="Copy room ID"
          >
            📋 Copy ID
          </button>
           {/* Photo dropdown wrapper */}
<div style={{ position: 'relative' }}>
  <button
    onClick={() => setShowPhotoOptions(prev => !prev)}
    style={{
      backgroundColor: '#007bff',
      color: 'white',
      border: 'none',
      padding: '6px 12px',
      borderRadius: 4,
      cursor: 'pointer',
      fontSize: 12,
      fontWeight: 'bold'
    }}
  >
    📸 Photo ▾
  </button>

  {showPhotoOptions && (
    <div
      style={{
        position: 'absolute',
        top: '100%',
        right: 0,
        background: 'white',
        boxShadow: '0 4px 8px rgba(0,0,0,0.1)',
        borderRadius: 4,
        overflow: 'hidden',
        zIndex: 100
      }}
    >
      <button
        onClick={() => { /* take photo handler */ }}
        style={{ display: 'block', padding: '8px 12px', width: '100%', textAlign: 'left', border: 'none', background: 'none' }}
      >
        Take Photo
      </button>
      <button
        onClick={() => { /* upload photo handler */ }}
        style={{ display: 'block', padding: '8px 12px', width: '100%', textAlign: 'left', border: 'none', background: 'none' }}
      >
        Upload Photo
      </button>
    </div>
  )}
</div>

        </div>
        
        <p>
          Status: {connectionState} {isHost && '(Host)'} {isCallActive && '– Active'}
          {error && <span style={{ color: 'red' }}> • {error}</span>}
        </p>
        <div style={{ marginBottom: 10, gap: 10, display: 'flex' }}>
          <button onClick={handleEndCall} style={{ backgroundColor: '#dc3545', color: 'white', padding: '8px 16px', border: 'none', borderRadius: 4 }}>
            End Meeting
          </button>
          <button onClick={toggleAudio} style={{ backgroundColor: audioEnabled ? '#28a745' : '#dc3545', color: 'white', padding: '8px 16px', border: 'none', borderRadius: 4 }}>
            {audioEnabled ? 'Mute' : 'Unmute'}
          </button>
          <button onClick={toggleVideo} style={{ backgroundColor: videoEnabled ? '#28a745' : '#dc3545', color: 'white', padding: '8px 16px', border: 'none', borderRadius: 4 }}>
            {videoEnabled ? 'Video Off' : 'Video On'}
          </button>
          <button 
            onClick={isSharingLocal ? stopScreenShare : shareScreen} 
            disabled={screenSharingActive && !isSharingLocal} 
            title={screenSharingActive && !isSharingLocal ? 'Only one person can screen share at a time' : isSharingLocal ? 'Stop sharing' : 'Share Screen'} 
            style={{
              backgroundColor: isSharingLocal ? '#dc3545' : '#007bff', 
              color: 'white', 
              padding: '8px 16px', 
              border: 'none', 
              borderRadius: 4, 
              cursor: screenSharingActive && !isSharingLocal ? 'not-allowed' : 'pointer'
            }}
          >
            {isSharingLocal ? 'Stop Sharing' : 'Share Screen'}
          </button>
          <button
            onClick={() => setShowSettings(true)}
            style={{
              backgroundColor: '#6c757d',
              color: 'white',
              padding: '8px 16px',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            ⚙️ Settings
          </button>
        </div>
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <div>
            <h2>You: {userName}</h2>
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              controls={false}
              style={{ 
                width: 400, 
                height: 300, 
                background: '#000', 
                borderRadius: 8,
                objectFit: 'cover'
              }}
              onLoadedMetadata={(e) => {
                console.log('Local video metadata loaded');
                const video = e.currentTarget;
                video.play().then(() => {
                  console.log('Local video started playing');
                }).catch(error => {
                  console.error('Error playing local video:', error);
                });
              }}
              onError={(e) => {
                console.error('Local video error:', e);
              }}
              onCanPlay={() => {
                console.log('Local video can play');
              }}
            />
          </div>
          <div>
            <h2>{peerJoined && peerName ? peerName : 'Waiting for peer...'}</h2>
            {peerJoined ? (
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                style={{ 
                  width: 400, 
                  height: 300, 
                  background: '#000',
                  borderRadius: 8,
                  objectFit: 'cover'
                }}
                onLoadedMetadata={() => {
                  // Ensure remote video plays when metadata is loaded
                  if (remoteVideoRef.current) {
                    remoteVideoRef.current.play().catch(console.error);
                  }
                }}
              />
            ) : (
              <div
                style={{
                  width: 400,
                  height: 300,
                  background: '#f8f9fa',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 8,
                  border: '2px dashed #dee2e6'
                }}
              >
                Waiting for peer to join…
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Chat Sidebar */}
      <div style={{ 
        width: 300, 
        borderLeft: '1px solid #ccc', 
        display: 'flex', 
        flexDirection: 'column',
        backgroundColor: '#f8f9fa'
      }}>
        <div style={{ 
          flex: 1, 
          overflowY: 'auto', 
          padding: 10,
          backgroundColor: 'white'
        }}>
          {messages.map((msg, index) => (
            <div key={index} style={{ marginBottom: 12 }}>
              <small style={{ color: '#666' }}>
                {msg.sender === socket.id ? userName : peerName || 'Peer'} •{' '}
                {new Date(msg.timestamp).toLocaleTimeString()}
              </small>
              <div style={{ marginTop: 4 }}>
                {msg.type === 'text' && <span>{msg.message}</span>}
                {msg.type === 'image' && (
                  <img 
                    src={msg.message} 
                    alt="uploaded content" 
                    style={{ 
                      maxWidth: '100%', 
                      borderRadius: 4,
                      cursor: 'pointer'
                    }} 
                    onClick={() => window.open(msg.message, '_blank')}
                  />
                )}
                {msg.type === 'gif' && (
                  <img 
                    src={msg.message} 
                    alt="gif" 
                    style={{ 
                      maxWidth: '100%', 
                      borderRadius: 4,
                      cursor: 'pointer'
                    }} 
                  />
                )}
              </div>
            </div>
          ))}
        </div>
        
        {/* Chat Input */}
        <div style={{ 
          padding: 10, 
          borderTop: '1px solid #ccc', 
          position: 'relative',
          backgroundColor: 'white'
        }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <button 
              onClick={() => setShowEmojiPicker(prev => !prev)}
              style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer' }}
              title="Add emoji"
            >
              😊
            </button>
            <button 
              onClick={() => setShowGifPicker(prev => !prev)}
              style={{ background: 'none', border: 'none', fontSize: 14, cursor: 'pointer' }}
              title="Add GIF"
            >
              GIF
            </button>
            <label style={{ cursor: 'pointer', fontSize: 18 }} title="Upload image">
              📷
              <input 
                type="file" 
                accept="image/*" 
                style={{ display: 'none' }} 
                onChange={sendImage} 
              />
            </label>
          </div>
          
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendText()}
              placeholder="Type a message…"
              style={{ 
                flex: 1, 
                padding: '8px 12px',
                border: '1px solid #ddd',
                borderRadius: 4,
                outline: 'none'
              }}
            />
            <button 
              onClick={sendText}
              style={{ 
                backgroundColor: '#007bff', 
                color: 'white', 
                border: 'none', 
                padding: '8px 16px',
                borderRadius: 4,
                cursor: 'pointer'
              }}
            >
              Send
            </button>
          </div>

          {/* Emoji Picker */}
          {showEmojiPicker && (
            <div style={{ 
              position: 'absolute', 
              bottom: 70, 
              right: 10, 
              zIndex: 1000,
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              borderRadius: 8
            }}>
              <EmojiPicker onEmojiClick={onEmojiClick} />
            </div>
          )}
          
          {/* GIF Picker */}
          {showGifPicker && (
            <div style={{
              position: 'absolute',
              bottom: 70,
              right: 10,
              width: 280,
              maxHeight: 300,
              background: '#fff',
              border: '1px solid #ccc',
              borderRadius: 8,
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              overflowY: 'auto',
              padding: 8,
              zIndex: 1000,
            }}>
              <div style={{ display: 'flex', marginBottom: 8, gap: 4 }}>
                <input
                  value={gifQuery}
                  onChange={(e) => setGifQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && fetchGiphyGifs()}
                  placeholder="Search GIFs…"
                  style={{ 
                    flex: 1, 
                    padding: '6px 8px',
                    border: '1px solid #ddd',
                    borderRadius: 4,
                    fontSize: 14
                  }}
                />
                <button 
                  onClick={fetchGiphyGifs}
                  style={{ 
                    backgroundColor: '#007bff', 
                    color: 'white', 
                    border: 'none', 
                    padding: '6px 12px',
                    borderRadius: 4,
                    fontSize: 14,
                    cursor: 'pointer'
                  }}
                >
                  Search
                </button>
              </div>
              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: '1fr 1fr', 
                gap: 6 
              }}>
                {gifResults.map((url, index) => (
                  <img
                    key={index}
                    src={url}
                    alt={`GIF ${index + 1}`}
                    onClick={() => sendGif(url)}
                    style={{ 
                      width: '100%', 
                      cursor: 'pointer', 
                      borderRadius: 4,
                      transition: 'transform 0.1s',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = 'scale(1.05)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = 'scale(1)';
                    }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <div
          onClick={() => setShowSettings(false)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 2000,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              backgroundColor: 'white',
              padding: 20,
              borderRadius: 8,
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              maxWidth: 400,
              width: '90%',
            }}
          >
            <h2 style={{ margin: '0 0 20px 0', color: 'black' }}>Settings</h2>
            <div style={{ marginBottom: 15 }}>
              <label style={{ display: 'block', marginBottom: 8, color: 'black', fontWeight: 'bold' }}>
                Upload Background Image:
              </label>
              <input
                type="file"
                accept="image/*"
                onChange={handleBackgroundUpload}
                style={{ 
                  display: 'block',
                  width: '100%',
                  padding: 8,
                  border: '1px solid #ddd',
                  borderRadius: 4,
                  backgroundColor: 'white'
                }}
              />
              <small style={{ color: '#666', fontSize: 12, marginTop: 4, display: 'block' }}>
                This will sync the background for both participants
              </small>
            </div>
            <button
              onClick={() => setShowSettings(false)}
              style={{
                backgroundColor: '#007bff',
                color: 'white',
                border: 'none',
                padding: '8px 16px',
                borderRadius: 4,
                cursor: 'pointer',
                float: 'right'
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* End Meeting Dialog */}
      {showEndDialog && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          backgroundColor: 'rgba(0,0,0,0.8)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 2000
        }}>
          <div style={{
            backgroundColor: 'white',
            padding: 40,
            borderRadius: 10,
            textAlign: 'center',
            boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
            maxWidth: 400
          }}>
            <div style={{ fontSize: 48, marginBottom: 20 }}>👋</div>
            <h2 style={{ marginBottom: 20, color: '#333' }}>Meeting Ended</h2>
            <p style={{ marginBottom: 20, fontSize: 16, lineHeight: 1.5 }}>
              {endDialogMessage}
            </p>
            <p style={{ 
              color: '#007bff', 
              fontSize: 18, 
              fontWeight: 'bold',
              marginBottom: 0 
            }}>
              Returning to home page in {countdown} seconds...
            </p>
          </div>
        </div>
      )}
    </div>
  );
}