// pages/room/[id].tsx - COMPLETE FIXED VERSION
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
  const remoteScreenRef = useRef<HTMLVideoElement>(null);
  const screenVideoRef = useRef<HTMLVideoElement>(null);
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

  // Name handling
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
  const [endDialogMessage, setEndDialogMessage] = useState('');
  const [screenSharingActive, setScreenSharingActive] = useState(false);
  const [isSharingLocal, setIsSharingLocal] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [roomError, setRoomError] = useState<string | null>(null);
  const [showPhotoOptions, setShowPhotoOptions] = useState(false);

  // Photo menu states
  const [showPhotoMenu, setShowPhotoMenu] = useState(false);
  const [showBoothMenu, setShowBoothMenu] = useState(false);
  const [photoReels, setPhotoReels] = useState<string[]>([]);

  const [signalingState, setSignalingState] = useState<RTCSignalingState>('stable');

  const iceServers = { 
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ] 
  };

  // Utility to map style names to CSS filter strings
  const getFilterCSS = useCallback((style: string) => {
    switch (style) {
      case 'contrast': return 'contrast(1.5)';
      case 'vintage':  return 'sepia(1)';
      case 'hue':      return 'hue-rotate(90deg)';
      case 'old':      return 'grayscale(0.5) brightness(0.8)';
      case 'bw':       return 'grayscale(1)';
      default:         return 'none';
    }
  }, []);

  // Normal window photo
  const handleWindowPhoto = useCallback(async () => {
  if (!localVideoRef.current) return;
  const video = localVideoRef.current;
  const w = video.videoWidth;
  const h = video.videoHeight;
  const textHeight = 40;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h + textHeight + 10;
  const ctx = canvas.getContext('2d')!;

  ctx.drawImage(video, 0, 0, w, h);

  // room name below
  ctx.font = '24px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = textColor;
  ctx.fillText(roomName || `Room: ${roomId}`, w / 2, h + 30);

  canvas.toBlob(blob => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'window-photo.jpeg';
    a.click();
    URL.revokeObjectURL(url);
  }, 'image/jpeg');

  setShowPhotoMenu(false);
}, [roomName, roomId, textColor]);


  // Photobooth reel with filter
 const handleBoothPhoto = useCallback(async (style: string) => {
  // 1) Load your template
  const template = new Image();
  template.src = '/reel template.png';
  await new Promise<void>(res => { template.onload = () => res() });
  
  // 2) Grab the two video elements
  const [topVid, bottomVid] = [ localVideoRef.current, remoteVideoRef.current ].filter(Boolean) as HTMLVideoElement[];
  if (!topVid || !bottomVid) return;
  
  // 3) Create canvas matching the template size
  const w = template.width;
  const h = template.height;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  // 4) Draw the template background
  ctx.drawImage(template, 0, 0, w, h);

  // 5) Compute the box areas (you’ll need to tweak these to match your template exactly)
  //    These values assume two equal boxes, each half the template-height minus padding.
  const padding = 20;            // space from edges
  const boxH  = (h - padding*3 - 40) / 2; // 40px reserved for the caption line at bottom
  const boxW  = w - padding*2;
  
  // 6) Draw top snapshot
 //tx.filter = getFilterCSS('none'); 
 const filterCSS = getFilterCSS(style);
  ctx.filter = filterCSS;
  ctx.drawImage(topVid,
    0, 0, topVid.videoWidth, topVid.videoHeight,
    padding, padding,
    boxW, boxH
  );

  // 7) Draw bottom snapshot with the chosen filter
//ctx.filter = getFilterCSS(style);
  ctx.drawImage(bottomVid,
    0, 0, bottomVid.videoWidth, bottomVid.videoHeight,
    padding, padding*2 + boxH,
    boxW, boxH
  );
  ctx.filter = 'none';

  // 8) Caption your room name on the line area
  ctx.font = '24px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = textColor;
  const captionY = padding*2 + boxH*2 + 20;
  ctx.fillText(roomName || `Room: ${roomId}`, w/2, captionY);

  // 9) Export & download
  canvas.toBlob(blob => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href    = url;
    a.download = `booth-${style}.jpeg`;
    a.click();
    URL.revokeObjectURL(url);
  }, 'image/jpeg');

  // 10) Close menus
  setShowPhotoMenu(false);
  setShowBoothMenu(false);
}, [getFilterCSS, roomName, roomId, textColor]);


  // Initialize or return existing RTCPeerConnection
  const initPeerConnection = useCallback((): RTCPeerConnection => {
    if (peerConnectionRef.current && peerConnectionRef.current.connectionState !== 'closed') {
      return peerConnectionRef.current;
    }

    const pc = new RTCPeerConnection(iceServers);
    peerConnectionRef.current = pc;

    // Add local tracks in consistent order - video first, then audio
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
      
      // Check if this is screen share
      if (event.track.kind === 'video' && remoteStream.getVideoTracks()[0]?.label?.includes('screen')) {
        if (remoteScreenRef.current) {
          remoteScreenRef.current.srcObject = remoteStream;
        }
        setRemoteScreenStream(remoteStream);
      } else {
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

  // Reset PeerConnection
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
    
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
  }, []);

  // Create & send offer (host)
  const createOffer = useCallback(async () => {
    if (!roomId || !localStreamRef.current || !isHost) {
      console.log('Cannot create offer: missing requirements');
      return;
    }

    try {
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

  // Handle incoming offer and send answer
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
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
        peerConnectionRef.current = null;
      }
      
      const pc = initPeerConnection();
      
      console.log('Current signaling state:', pc.signalingState);
      console.log('Is making offer:', makingOfferRef.current);
      
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

  // Handle incoming answer
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

  // Handle ICE candidate
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

  // Handle background upload
  const handleBackgroundUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !roomId) return;

    try {
      const formData = new FormData();
      formData.append('file', file);
      
      const response = await fetch('/api/upload', { 
        method: 'POST',
        headers: {
    'X-Room-ID': roomId, // Add room ID to headers
  }, 
        body: formData 
      });
      const { url, error } = await response.json();
      
      if (url) {
        setBackgroundImage(url);
        socket.emit('background-sync', { roomId, backgroundUrl: url });
        
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
  }, [roomId]);

  // End meeting dialog with countdown
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

  // Copy room ID to clipboard
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

  // Chat helpers
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
    formData.append('roomId', roomId);
    
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

  // Fetch Giphy GIFs
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

  // When peer joins, host sends offer
  const handlePeerJoined = useCallback(() => {
    console.log('Peer joined');
    setPeerJoined(true);
    
    if (isHost && localStreamRef.current) {
      socket.emit('set-name', { roomId, name: userName });
      setTimeout(() => {
        createOffer();
      }, 1000);
    }
  }, [isHost, createOffer, roomId, userName]);

  // Media control functions
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

  // Screen share
  const shareScreen = useCallback(async () => {
    const pc = peerConnectionRef.current;
    if (!pc) return;
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true
      });
      screenStreamRef.current = screenStream;

      setScreenSharingActive(true);
      setIsSharingLocal(true);
      socket.emit('screen-share-started', roomId);

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

  // Stop screen share
  const stopScreenShare = useCallback(async () => {
    const pc = peerConnectionRef.current;
    const screenStream = screenStreamRef.current;
    if (!pc || !screenStream) return;

    screenStream.getTracks().forEach(t => t.stop());
    screenStreamRef.current = null;

    const videoSender = pc.getSenders().find(s => s.track?.kind === 'video');
    if (videoSender && localStreamRef.current) {
      const camTrack = localStreamRef.current.getVideoTracks()[0];
      await videoSender.replaceTrack(camTrack);
    }

    setScreenSharingActive(false);
    setIsSharingLocal(false);
    socket.emit('screen-share-stopped', roomId);
  }, [roomId]);

  // End call
//const handleEndCall = useCallback(() => {
const handleEndCall = useCallback(async () => {
  if (roomId && userName) {
    socket.emit('end-meeting', { roomId, endedBy: userName });
    
    // Add cleanup call here
    try {
      await fetch('/api/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId }),
      });
    } catch (error) {
      console.error('Cleanup failed:', error);
    }
  }
  
  if (localStreamRef.current) {
    localStreamRef.current.getTracks().forEach(track => track.stop());
  }
  
  resetPeerConnection();
  router.push('/');
}, [roomId, userName, resetPeerConnection, router]);

  // Prompt for user name
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const name = (window.prompt('Enter your name') || 'Anonymous').trim();
      setUserName(name);
    }
  }, []);

  // Broadcast name to peer
  useEffect(() => {
    if (userName && roomId) {
      socket.emit('set-name', { roomId, name: userName });
      
      const timeoutId = setTimeout(() => {
        socket.emit('set-name', { roomId, name: userName });
      }, 1000);
      
      return () => clearTimeout(timeoutId);
    }
  }, [userName, roomId]);

  // Get local media first
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

  // Socket event listeners
  useEffect(() => {
    if (!roomId || mediaLoading || !userName) return;

    console.log('Setting up socket listeners for room:', roomId);

   const handlePeerLeft = async () => {
      console.log('Peer left');
      resetPeerConnection();
      setPeerJoined(false);
      setPeerName('');
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = null;
      }

        if (roomId) {
    try {
      await fetch('/api/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId }),
      });
      console.log('Cleanup completed after peer left');
    } catch (error) {
      console.error('Cleanup failed:', error);
    }
  }

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
        const raw = window.prompt('Enter a name for this room')?.trim();
        const finalName = raw && raw.length
          ? raw
          : `${userName}'s room`;
        setRoomName(finalName);
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

  // Fetch trending GIFs when picker opens
  useEffect(() => {
    if (showGifPicker) {
      fetchGiphyGifs();
    }
  }, [showGifPicker, fetchGiphyGifs]);

  useEffect(() => {
    const handleBeforeUnload = async () => {
      if (roomId) {
        // Use sendBeacon for reliable cleanup on page unload
        const data = JSON.stringify({ roomId });
        navigator.sendBeacon('/api/cleanup', data);
      }
    };

    const handleUnload = async () => {
      if (roomId) {
        try {
          await fetch('/api/cleanup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ roomId }),
          });
        } catch (error) {
          console.error('Cleanup on unload failed:', error);
        }
      }
    };

    // Add event listeners
    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('unload', handleUnload);

    // Cleanup function
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('unload', handleUnload);
      
      // Also trigger cleanup when component unmounts
      if (roomId) {
        fetch('/api/cleanup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomId }),
        }).catch(console.error);
      }
    };
  }, [roomId]);

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

  // Main render
  return (
    <>
      <style jsx>{`
        .photo-dropdown {
          position: absolute;
          top: 100%;
          right: 0;
          background: white;
          border: 1px solid #ddd;
          border-radius: 4px;
          box-shadow: 0 4px 8px rgba(0,0,0,0.1);
          overflow: hidden;
          z-index: 100;
          min-width: 120px;
        }
        
        .photo-dropdown.nested {
          top: 0;
          left: 100%;
          margin-left: 4px;
        }
        
        .photo-dropdown button {
          display: block;
          width: 100%;
          padding: 8px 12px;
          border: none;
          background: none;
          text-align: left;
          cursor: pointer;
          color: black;
          font-size: 14px;
        }
        
        .photo-dropdown button:hover {
          background-color: #f8f9fa;
        }
        
        .photo-reel {
          position: fixed;
          bottom: 20px;
          left: 20px;
          display: flex;
          gap: 8px;
          max-width: 500px;
          flex-wrap: wrap;
          z-index: 50;
        }
        
        .photo-reel img {
          border-radius: 4px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.2);
          cursor: pointer;
        }
        
        .photo-reel-container {
          position: relative;
        }
      `}</style>
      
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
                onClick={() => {
                  setShowPhotoMenu(p => !p);
                  setShowBoothMenu(false);
                }}
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
                📸 Photos ▾
              </button>

              {showPhotoMenu && (
                <div className="photo-dropdown">
                  <button onClick={handleWindowPhoto}>Normal Photo</button>
                  <button onClick={() => setShowBoothMenu(b => !b)}>Photobooth ▶</button>
                </div>
              )}

              {showBoothMenu && (
                <div className="photo-dropdown nested">
                  {['normal','contrast','vintage','hue','old','bw'].map(style => (
                    <button key={style} onClick={() => handleBoothPhoto(style)}>
                      {style.charAt(0).toUpperCase() + style.slice(1)}
                    </button>
                  ))}
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

        {/* Photo Reel Display */}
        {photoReels.length > 0 && (
          <div className="photo-reel">
            <div className="photo-reel-container">
              {photoReels.map((src, idx) => (
                <img 
                  key={idx} 
                  src={src} 
                  alt={`Photo ${idx + 1}`}
                  style={{ width: 120, height: 90, objectFit: 'cover', marginRight: 8 }}
                  onClick={() => window.open(src, '_blank')}
                />
              ))}
              <button
                onClick={() => setPhotoReels([])}
                style={{
                  position: 'absolute',
                  top: -8,
                  right: -8,
                  background: '#dc3545',
                  color: 'white',
                  border: 'none',
                  borderRadius: '50%',
                  width: 24,
                  height: 24,
                  cursor: 'pointer',
                  fontSize: 12,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                ✕
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}