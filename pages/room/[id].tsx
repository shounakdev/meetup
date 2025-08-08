import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/router';
import dynamic from 'next/dynamic';
import socket from '@/utils/socket';
import type { EmojiClickData } from 'emoji-picker-react';
import Head from 'next/head';

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
  
  // Separate refs for pinned video elements
  const pinnedRemoteVideoRef = useRef<HTMLVideoElement>(null);
  const pinnedRemoteScreenRef = useRef<HTMLVideoElement>(null);
  
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
  
  // New UI state
  const [controlsVisible, setControlsVisible] = useState(true);
  const [chatDarkMode, setChatDarkMode] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<{[key: string]: 'uploading' | 'done'}>({});
  const [animatingEmojis, setAnimatingEmojis] = useState<{id: string, emoji: string, x: number, y: number}[]>([]);
  
  // Socket connection state
  const [socketConnected, setSocketConnected] = useState(false);
  const [showMessaging, setShowMessaging] = useState(true);
  
  // Add initialization state to track the setup process
  const [isInitialized, setIsInitialized] = useState(false);
  const [showNamePrompt, setShowNamePrompt] = useState(true);
  const [showRoomNamePrompt, setShowRoomNamePrompt] = useState(false);
  
  // Pin video state
  const [isPinned, setIsPinned] = useState(false);
  const [pinnedVideoSize, setPinnedVideoSize] = useState({ width: 800, height: 600 });
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  
  // Draggable controls state
  const [controlsPosition, setControlsPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);
  const controlsRef = useRef<HTMLDivElement>(null);

  // Store the current remote stream for proper management
  const [currentRemoteStream, setCurrentRemoteStream] = useState<MediaStream | null>(null);

  const iceServers = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };

  // Draggable controls handlers
  const handleControlsDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      startX: controlsPosition.x,
      startY: controlsPosition.y
    };
  }, [controlsPosition]);

  const handleControlsDragMove = useCallback((e: MouseEvent) => {
    if (!isDragging || !dragStartRef.current) return;

    const deltaX = e.clientX - dragStartRef.current.x;
    const deltaY = e.clientY - dragStartRef.current.y;

    const newX = dragStartRef.current.startX + deltaX;
    const newY = dragStartRef.current.startY + deltaY;

    // Constrain to viewport
    const maxX = window.innerWidth - 400; // Approximate control bar width
    const maxY = window.innerHeight - 100; // Approximate control bar height
    
    setControlsPosition({
      x: Math.max(-maxX/2, Math.min(maxX/2, newX)),
      y: Math.max(-50, Math.min(50, newY))
    });
  }, [isDragging]);

  const handleControlsDragEnd = useCallback(() => {
    setIsDragging(false);
    dragStartRef.current = null;
  }, []);

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleControlsDragMove);
      document.addEventListener('mouseup', handleControlsDragEnd);
      return () => {
        document.removeEventListener('mousemove', handleControlsDragMove);
        document.removeEventListener('mouseup', handleControlsDragEnd);
      };
    }
  }, [isDragging, handleControlsDragMove, handleControlsDragEnd]);

  // Check socket connection on mount
  useEffect(() => {
    const checkSocketConnection = () => {
      if (socket.connected) {
        setSocketConnected(true);
        setError(null);
      } else {
        setSocketConnected(false);
        setError('Connecting to server...');
        
        // Try to reconnect
        if (socket.disconnected) {
          socket.connect();
        }
      }
    };

    // Initial check
    checkSocketConnection();

    // Set up socket event listeners
    const handleConnect = () => {
      console.log('Socket connected');
      setSocketConnected(true);
      setError(null);
    };

    const handleDisconnect = (reason: string) => {
      console.log('Socket disconnected:', reason);
      setSocketConnected(false);
      setError(`Connection lost: ${reason}`);
    };

    const handleConnectError = (error: any) => {
      console.error('Socket connection error:', error);
      setSocketConnected(false);
      setError('Failed to connect to server. Please check your internet connection.');
    };

    const handleReconnect = () => {
      console.log('Socket reconnected');
      setSocketConnected(true);
      setError(null);
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('connect_error', handleConnectError);
    socket.on('reconnect', handleReconnect);

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('connect_error', handleConnectError);
      socket.off('reconnect', handleReconnect);
    };
  }, []);

  // Utility to map style names to CSS filter strings
  const getFilterCSS = useCallback((style: string) => {
    switch (style) {
      case 'contrast': return 'contrast(1.5)';
      case 'vintage': return 'sepia(1)';
      case 'hue': return 'hue-rotate(90deg)';
      case 'old': return 'grayscale(0.5) brightness(0.8)';
      case 'bw': return 'grayscale(1)';
      default: return 'none';
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
    const [topVid, bottomVid] = [localVideoRef.current, remoteVideoRef.current].filter(Boolean) as HTMLVideoElement[];
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
    
    // 5) Compute the box areas
    const padding = 20;
    const boxH = (h - padding * 3 - 40) / 2;
    const boxW = w - padding * 2;
    
    // 6) Draw top snapshot
    const filterCSS = getFilterCSS(style);
    ctx.filter = filterCSS;
    ctx.drawImage(topVid,
      0, 0, topVid.videoWidth, topVid.videoHeight,
      padding, padding,
      boxW, boxH
    );
    
    // 7) Draw bottom snapshot with the chosen filter
    ctx.drawImage(bottomVid,
      0, 0, bottomVid.videoWidth, bottomVid.videoHeight,
      padding, padding * 2 + boxH,
      boxW, boxH
    );
    
    ctx.filter = 'none';
    
    // 8) Caption your room name on the line area
    ctx.font = '24px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = textColor;
    const captionY = padding * 2 + boxH * 2 + 20;
    ctx.fillText(roomName || `Room: ${roomId}`, w / 2, captionY);
    
    // 9) Export & download
    canvas.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `booth-${style}.jpeg`;
      a.click();
      URL.revokeObjectURL(url);
    }, 'image/jpeg');
    
    // 10) Close menus
    setShowPhotoMenu(false);
    setShowBoothMenu(false);
  }, [getFilterCSS, roomName, roomId, textColor]);

  // Fixed: Ensure local video is always connected to stream
  const connectLocalVideo = useCallback(() => {
    if (localVideoRef.current && localStreamRef.current) {
      console.log('🎥 Connecting local video to stream');
      localVideoRef.current.srcObject = localStreamRef.current;
      localVideoRef.current.muted = true;
      localVideoRef.current.playsInline = true;
      localVideoRef.current.autoplay = true;
      
      // Force play
      localVideoRef.current.play().catch(error => {
        console.error('Error playing local video:', error);
        setTimeout(() => {
          if (localVideoRef.current) {
            localVideoRef.current.play().catch(console.error);
          }
        }, 100);
      });
    }
  }, []);

  // Helper function to assign stream to video element
  const assignStreamToVideo = useCallback((videoElement: HTMLVideoElement | null, stream: MediaStream | null) => {
    if (videoElement && stream) {
      console.log('📺 Assigning stream to video element');
      videoElement.srcObject = stream;
      videoElement.play().catch(error => {
        console.error('Error playing video:', error);
        setTimeout(() => {
          if (videoElement.srcObject === stream) {
            videoElement.play().catch(console.error);
          }
        }, 100);
      });
    }
  }, []);

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
      
      // Store the current remote stream
      setCurrentRemoteStream(remoteStream);
      
      // Check if this is screen share
      if (event.track.kind === 'video' && remoteStream.getVideoTracks()[0]?.label?.includes('screen')) {
        console.log('📺 Screen share stream received');
        setRemoteScreenStream(remoteStream);
        
        // Assign to main screen ref
        assignStreamToVideo(remoteScreenRef.current, remoteStream);
        
        // If pinned, also assign to pinned screen ref
        if (isPinned) {
          assignStreamToVideo(pinnedRemoteScreenRef.current, remoteStream);
        }
      } else {
        console.log('📺 Regular video stream received');
        
        // Assign to main video ref
        assignStreamToVideo(remoteVideoRef.current, remoteStream);
        
        // If pinned, also assign to pinned video ref
        if (isPinned) {
          assignStreamToVideo(pinnedRemoteVideoRef.current, remoteStream);
        }
      }
    };
    
    pc.onicecandidate = (event) => {
      if (event.candidate && roomId && socketConnected) {
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
  }, [roomId, socketConnected, isPinned, assignStreamToVideo]);

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
    setCurrentRemoteStream(null);
    
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
    if (pinnedRemoteVideoRef.current) {
      pinnedRemoteVideoRef.current.srcObject = null;
    }
  }, []);

  // Create & send offer (host)
  const createOffer = useCallback(async () => {
    if (!roomId || !localStreamRef.current || !isHost || !socketConnected) {
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
  }, [roomId, isHost, initPeerConnection, socketConnected]);

  // Handle incoming offer and send answer
  const createAnswer = useCallback(async (offer: RTCSessionDescriptionInit) => {
    if (!roomId || !localStreamRef.current || !socketConnected) {
      console.error('Cannot create answer: missing roomId, localStream, or socket connection');
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
  }, [roomId, initPeerConnection, isHost, socketConnected]);

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
    
    const uploadId = Date.now().toString();
    setUploadStatus(prev => ({ ...prev, [uploadId]: 'uploading' }));
    
    try {
      const formData = new FormData();
      formData.append('file', file);
      
      const response = await fetch('/api/upload', {
        method: 'POST',
        headers: {
          'X-Room-ID': roomId,
        },
        body: formData
      });
      
      const { url, error } = await response.json();
      
      if (url) {
        setBackgroundImage(url);
        if (socketConnected) {
          socket.emit('background-sync', { roomId, backgroundUrl: url });
        }
        
        const img = new Image();
        img.crossOrigin = "anonymous";
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
            sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
          }
          const avg = sum / (data.length / 4);
          setTextColor(avg > 128 ? 'black' : 'white');
        };
        
        setUploadStatus(prev => ({ ...prev, [uploadId]: 'done' }));
        setTimeout(() => {
          setUploadStatus(prev => {
            const newStatus = { ...prev };
            delete newStatus[uploadId];
            return newStatus;
          });
        }, 2000);
      } else if (error) {
        setError(`Upload failed: ${error}`);
        setUploadStatus(prev => {
          const newStatus = { ...prev };
          delete newStatus[uploadId];
          return newStatus;
        });
      }
    } catch (error) {
      console.error('Background upload error:', error);
      setError('Failed to upload background image');
      setUploadStatus(prev => {
        const newStatus = { ...prev };
        delete newStatus[uploadId];
        return newStatus;
      });
    } finally {
      e.target.value = '';
    }
  }, [roomId, socketConnected]);

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
      // Show gentle success message instead of error-style message
      const originalError = error;
      setError('✅ Room ID copied to clipboard');
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

  // Animate emoji
  const animateEmoji = useCallback((emoji: string) => {
    const id = Date.now().toString();
    const x = Math.random() * 200;
    const y = Math.random() * 100;
    
    setAnimatingEmojis(prev => [...prev, { id, emoji, x, y }]);
    
    setTimeout(() => {
      setAnimatingEmojis(prev => prev.filter(e => e.id !== id));
    }, 2000);
  }, []);

  const sendText = useCallback(() => {
    if (!chatInput.trim() || !roomId || !socketConnected) return;
    
    const message: ChatMsg = {
      sender: socket.id || userName,
      message: chatInput,
      type: 'text',
      timestamp: Date.now()
    };
    
    // Check if message contains emoji
    const emojiRegex = /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu;
    const emojis = chatInput.match(emojiRegex);
    if (emojis) {
      emojis.forEach(emoji => animateEmoji(emoji));
    }
    
    socket.emit('chat-message', { roomId, ...message });
    appendMessage(message);
    setChatInput('');
    setShowEmojiPicker(false);
  }, [chatInput, roomId, userName, appendMessage, animateEmoji, socketConnected]);

  const onEmojiClick = useCallback((emojiData: EmojiClickData) => {
    setChatInput((prev) => prev + emojiData.emoji);
  }, []);

  const sendImage = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !roomId || !socketConnected) return;
    
    const uploadId = Date.now().toString();
    setUploadStatus(prev => ({ ...prev, [uploadId]: 'uploading' }));
    
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
        
        setUploadStatus(prev => ({ ...prev, [uploadId]: 'done' }));
        setTimeout(() => {
          setUploadStatus(prev => {
            const newStatus = { ...prev };
            delete newStatus[uploadId];
            return newStatus;
          });
        }, 2000);
      } else if (error) {
        setError(`Upload failed: ${error}`);
        setUploadStatus(prev => {
          const newStatus = { ...prev };
          delete newStatus[uploadId];
          return newStatus;
        });
      }
    } catch (error) {
      console.error('Upload error:', error);
      setError('Failed to upload image');
      setUploadStatus(prev => {
        const newStatus = { ...prev };
        delete newStatus[uploadId];
        return newStatus;
      });
    } finally {
      e.target.value = '';
    }
  }, [roomId, userName, appendMessage, socketConnected]);

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
    if (!roomId || !socketConnected) return;
    
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
  }, [roomId, userName, appendMessage, socketConnected]);

  // When peer joins, host sends offer
  const handlePeerJoined = useCallback(() => {
    console.log('Peer joined');
    setPeerJoined(true);
    
    if (isHost && localStreamRef.current && socketConnected) {
      socket.emit('set-name', { roomId, name: userName });
      setTimeout(() => {
        createOffer();
      }, 1000);
    }
  }, [isHost, createOffer, roomId, userName, socketConnected]);

  // Fixed: Media control functions with proper video connection
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
      
      // Ensure local video stays connected after toggle
      setTimeout(() => {
        connectLocalVideo();
      }, 100);
    }
  }, [connectLocalVideo]);

  // Screen share
  const shareScreen = useCallback(async () => {
    const pc = peerConnectionRef.current;
    if (!pc || !socketConnected) return;
    
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
          if (socketConnected) {
            socket.emit('screen-share-stopped', roomId);
          }
          const camTrack = localStreamRef.current!.getVideoTracks()[0];
          await videoSender.replaceTrack(camTrack);
          // Reconnect local video after screen share ends
          setTimeout(() => {
            connectLocalVideo();
          }, 100);
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
  }, [roomId, socketConnected, connectLocalVideo]);

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
    if (socketConnected) {
      socket.emit('screen-share-stopped', roomId);
    }
    
    // Reconnect local video after stopping screen share
    setTimeout(() => {
      connectLocalVideo();
    }, 100);
  }, [roomId, socketConnected, connectLocalVideo]);

  // End call
  const handleEndCall = useCallback(async () => {
    if (roomId && userName && socketConnected) {
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
  }, [roomId, userName, resetPeerConnection, router, socketConnected]);

  // Fixed: Pin video functionality with proper stream management
  const togglePinVideo = useCallback(() => {
    setIsPinned(prev => {
      const newPinned = !prev;
      console.log('📌 Pin toggled:', newPinned);
      
      if (newPinned) {
        // When pinning, assign current streams to pinned video elements
        setTimeout(() => {
          if (screenSharingActive && remoteScreenStream) {
            console.log('📺 Assigning screen stream to pinned element');
            assignStreamToVideo(pinnedRemoteScreenRef.current, remoteScreenStream);
          } else if (currentRemoteStream) {
            console.log('📺 Assigning video stream to pinned element');
            assignStreamToVideo(pinnedRemoteVideoRef.current, currentRemoteStream);
          }
        }, 100);
      } else {
        // When unpinning, reassign streams back to main video elements
        setTimeout(() => {
          console.log('📺 Unpinning - reassigning streams to main elements');
          if (screenSharingActive && remoteScreenStream) {
            console.log('📺 Reassigning screen stream to main element');
            assignStreamToVideo(remoteScreenRef.current, remoteScreenStream);
          } else if (currentRemoteStream) {
            console.log('📺 Reassigning video stream to main element');
            assignStreamToVideo(remoteVideoRef.current, currentRemoteStream);
          }
        }, 100);
      }
      
      return newPinned;
    });
  }, [screenSharingActive, remoteScreenStream, currentRemoteStream, assignStreamToVideo]);

  // Handle resize functionality
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    resizeStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      width: pinnedVideoSize.width,
      height: pinnedVideoSize.height
    };
  }, [pinnedVideoSize]);

  const handleResizeMove = useCallback((e: MouseEvent) => {
    if (!isResizing || !resizeStartRef.current) return;
    
    const deltaX = e.clientX - resizeStartRef.current.x;
    const deltaY = e.clientY - resizeStartRef.current.y;
    
    const newWidth = Math.max(400, resizeStartRef.current.width + deltaX);
    const newHeight = Math.max(300, resizeStartRef.current.height + deltaY);
    
    setPinnedVideoSize({ width: newWidth, height: newHeight });
  }, [isResizing]);

  const handleResizeEnd = useCallback(() => {
    setIsResizing(false);
    resizeStartRef.current = null;
  }, []);

  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleResizeMove);
      document.addEventListener('mouseup', handleResizeEnd);
      return () => {
        document.removeEventListener('mousemove', handleResizeMove);
        document.removeEventListener('mouseup', handleResizeEnd);
      };
    }
  }, [isResizing, handleResizeMove, handleResizeEnd]);

  // Simplified name prompt effect
  useEffect(() => {
    if (typeof window !== 'undefined' && !userName && showNamePrompt) {
      const promptContainer = document.createElement('div');
      promptContainer.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: linear-gradient(135deg, #0f0f23 0%, #1a1a2e 25%, #16213e 50%, #0f3460 75%, #533483 100%);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 10000;
        font-family: 'Inter', sans-serif;
      `;
      
      const promptBox = document.createElement('div');
      promptBox.style.cssText = `
        background: rgba(255, 255, 255, 0.95);
        backdrop-filter: blur(20px);
        padding: 40px;
        border-radius: 24px;
        box-shadow: 0 30px 60px rgba(0,0,0,0.4);
        text-align: center;
        max-width: 400px;
        width: 90%;
        border: 1px solid rgba(255, 255, 255, 0.2);
      `;
      
      promptBox.innerHTML = `
        <div style="font-size: 48px; margin-bottom: 20px;">👋</div>
        <h2 style="color: #1e293b; margin-bottom: 20px; font-size: 24px; font-weight: 700;">Welcome to the Video Call</h2>
        <p style="color: #64748b; margin-bottom: 30px; font-size: 16px;">Please enter your name to join the room</p>
        <input type="text" id="nameInput" placeholder="Enter your name..." style="
          width: 100%;
          padding: 16px;
          border: 2px solid #e2e8f0;
          border-radius: 12px;
          font-size: 16px;
          margin-bottom: 20px;
          outline: none;
          font-family: 'Inter', sans-serif;
          transition: border-color 0.3s ease;
        " />
        <button id="joinBtn" style="
          background: linear-gradient(135deg, #6366f1, #8b5cf6);
          color: white;
          border: none;
          padding: 16px 32px;
          border-radius: 12px;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          font-family: 'Inter', sans-serif;
          box-shadow: 0 4px 15px rgba(99, 102, 241, 0.3);
          transition: all 0.3s ease;
        ">Join Room</button>
      `;
      
      promptContainer.appendChild(promptBox);
      document.body.appendChild(promptContainer);
      
      setTimeout(() => {
        const nameInput = document.getElementById('nameInput') as HTMLInputElement;
        const joinBtn = document.getElementById('joinBtn') as HTMLButtonElement;
        
        if (nameInput && joinBtn) {
          nameInput.focus();
          
          const handleJoin = () => {
            const name = nameInput.value.trim() || 'Anonymous';
            setUserName(name);
            setShowNamePrompt(false);
            document.body.removeChild(promptContainer);
          };
          
          joinBtn.addEventListener('click', handleJoin);
          nameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') handleJoin();
          });
        }
      }, 100);
    }
  }, [userName, showNamePrompt]);

  // Fixed: Get local media after user name is set with proper video connection
  useEffect(() => {
    if (!roomId || !userName || mediaLoading === false) return;
    
    const initializeMedia = async () => {
      try {
        console.log('🎥 Starting media initialization...');
        setMediaLoading(true);
        setError(null);
        
        console.log('🎥 Requesting user media...');
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
        
        console.log('🎥 Media stream obtained:', {
          videoTracks: stream.getVideoTracks().length,
          audioTracks: stream.getAudioTracks().length,
          active: stream.active
        });
        
        localStreamRef.current = stream;
        
        // Connect local video immediately
        connectLocalVideo();
        
        setMediaLoading(false);
        setIsInitialized(true);
        
      } catch (error) {
        console.error('🎥 Error accessing media devices:', error);
        setError(`Failed to access camera/microphone: ${(error as Error).message}`);
        setMediaLoading(false);
      }
    };
    
    initializeMedia();
    
    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, [roomId, userName, connectLocalVideo]);

  // Ensure local video stays connected
  useEffect(() => {
    const interval = setInterval(() => {
      if (localStreamRef.current && localVideoRef.current && !localVideoRef.current.srcObject) {
        console.log('🎥 Reconnecting disconnected local video');
        connectLocalVideo();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [connectLocalVideo]);

  // Effect to handle stream assignment when pin state changes
  useEffect(() => {
    if (isPinned && peerJoined) {
      console.log('📌 Pin state changed - assigning streams to pinned elements');
      
      if (screenSharingActive && remoteScreenStream) {
        assignStreamToVideo(pinnedRemoteScreenRef.current, remoteScreenStream);
      } else if (currentRemoteStream) {
        assignStreamToVideo(pinnedRemoteVideoRef.current, currentRemoteStream);
      }
    } else if (!isPinned && peerJoined) {
      console.log('📌 Unpin state changed - reassigning streams to main elements');
      
      if (screenSharingActive && remoteScreenStream) {
        assignStreamToVideo(remoteScreenRef.current, remoteScreenStream);
      } else if (currentRemoteStream) {
        assignStreamToVideo(remoteVideoRef.current, currentRemoteStream);
      }
    }
  }, [isPinned, peerJoined, screenSharingActive, remoteScreenStream, currentRemoteStream, assignStreamToVideo]);

  // Socket event listeners - only after initialization
  useEffect(() => {
    if (!roomId || !userName || !socketConnected || !isInitialized) return;
    
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
        
        // Animate emojis from received messages
        if (msg.type === 'text') {
          const emojiRegex = /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu;
          const emojis = msg.message.match(emojiRegex);
          if (emojis) {
            emojis.forEach(emoji => animateEmoji(emoji));
          }
        }
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
        img.crossOrigin = "anonymous";
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
            sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
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
    socket.on('room-name', ({ roomName }: { roomName: string }) => { setRoomName(roomName); });
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
        setShowRoomNamePrompt(true);
      } else if (!roomName) {
        const finalName = `${userName || 'Anonymous'}'s room`;
        setRoomName(finalName);
        socket.emit('room-name', { roomId, roomName: finalName });
      }
      if (userName) {
        setTimeout(() => socket.emit('set-name', { roomId, name: userName }), 100);
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
    userName,
    socketConnected,
    isInitialized,
    handlePeerJoined,
    createAnswer,
    handleAnswer,
    handleIceCandidate,
    resetPeerConnection,
    appendMessage,
    showEndMeetingDialog,
    router,
    roomName,
    animateEmoji
  ]);

  // Room name prompt for hosts
  useEffect(() => {
    if (showRoomNamePrompt && isHost && !roomName) {
      const promptContainer = document.createElement('div');
      promptContainer.style.cssText = `
        position: fixed; inset: 0;
        background: rgba(0,0,0,0.8);
        display: flex; justify-content: center; align-items: center;
        z-index: 10000; backdrop-filter: blur(20px);
        font-family: 'Inter', sans-serif;
      `;
      const promptBox = document.createElement('div');
      promptBox.style.cssText = `
        background: rgba(255, 255, 255, 0.95);
        backdrop-filter: blur(20px);
        padding: 40px; border-radius: 24px; max-width: 400px; width: 90%;
        box-shadow: 0 30px 60px rgba(0,0,0,0.4);
        border: 1px solid rgba(255, 255, 255, 0.2); text-align: center;
      `;
      promptBox.innerHTML = `
        <div style="font-size: 48px; margin-bottom: 20px;">🏠</div>
        <h2 style="color:#1e293b; margin-bottom:20px; font-size:24px; font-weight:700;">Name Your Room</h2>
        <p style="color:#64748b; margin-bottom:30px; font-size:16px;">Give your room a memorable name</p>
        <input type="text" id="roomNameInput" placeholder="Enter room name..." style="
          width:100%; padding:16px; border:2px solid #e2e8f0; border-radius:12px; font-size:16px; margin-bottom:20px; outline:none;
        " />
        <button id="createRoomBtn" style="
          background: linear-gradient(135deg, #6366f1, #8b5cf6);
          color:white; border:none; padding:16px 32px; border-radius:12px; font-size:16px; font-weight:600; cursor:pointer;
        ">Create Room</button>
      `;
      
      promptContainer.appendChild(promptBox);
      document.body.appendChild(promptContainer);
      
      setTimeout(() => {
        const roomNameInput = document.getElementById('roomNameInput') as HTMLInputElement | null;
        const createRoomBtn = document.getElementById('createRoomBtn') as HTMLButtonElement | null;
        if (!roomNameInput || !createRoomBtn) return;
        
        const handleCreate = () => {
          const name = roomNameInput.value.trim() || `${userName || 'Anonymous'}'s room`;
          setRoomName(name);
          socket.emit('room-name', { roomId, roomName: name });
          setShowRoomNamePrompt(false);
          document.body.removeChild(promptContainer);
        };
        
        createRoomBtn.addEventListener('click', handleCreate);
        roomNameInput.addEventListener('keydown', (e) => e.key === 'Enter' && handleCreate());
        roomNameInput.focus();
      }, 100);
    }
  }, [showRoomNamePrompt, isHost, roomName, userName, roomId]);

  // Fetch trending GIFs when picker opens
  useEffect(() => {
    if (showGifPicker) {
      fetchGiphyGifs();
    }
  }, [showGifPicker, fetchGiphyGifs]);

  useEffect(() => {
    const handleBeforeUnload = async () => {
      if (roomId) {
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
    
    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('unload', handleUnload);
    
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('unload', handleUnload);
      
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
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        padding: 20
      }}>
        <div style={{
          backgroundColor: 'rgba(255, 255, 255, 0.95)',
          padding: 40,
          borderRadius: 20,
          boxShadow: '0 20px 40px rgba(0,0,0,0.1)',
          textAlign: 'center',
          maxWidth: 500,
          backdropFilter: 'blur(10px)'
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
  if (mediaLoading || !isInitialized) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        color: 'white',
        fontSize: '18px'
      }}>
        <div style={{
          textAlign: 'center',
          padding: 40,
          borderRadius: 20,
          backgroundColor: 'rgba(255, 255, 255, 0.1)',
          backdropFilter: 'blur(10px)'
        }}>
          <div style={{ marginBottom: 20, fontSize: 48 }}>📹</div>
          <div>Loading camera and microphone...</div>
          <div style={{ fontSize: '14px', opacity: 0.8, marginTop: '10px' }}>
            Please allow camera and microphone access when prompted
          </div>
          <div style={{ fontSize: '12px', opacity: 0.6, marginTop: '20px' }}>
            Debug info: userName={userName}, roomId={roomId}, socketConnected={socketConnected}
          </div>
          {error && (
            <div style={{ fontSize: '12px', color: '#fca5a5', marginTop: '10px' }}>
              Error: {error}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Show socket connection error
  if (!socketConnected) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        color: 'white',
        fontSize: '18px'
      }}>
        <div style={{
          textAlign: 'center',
          padding: 40,
          borderRadius: 20,
          backgroundColor: 'rgba(255, 255, 255, 0.1)',
          backdropFilter: 'blur(10px)'
        }}>
          <div style={{ marginBottom: 20, fontSize: 48 }}>🔌</div>
          <div>Connecting to server...</div>
          <div style={{ fontSize: '14px', opacity: 0.8, marginTop: '10px' }}>
            Please check your internet connection
          </div>
        </div>
      </div>
    );
  }

  // Main render
  return (
    <>
      <Head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
      </Head>
      
      <style jsx>{`
        * {
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
        }
        
        .modern-container {
          background: ${backgroundImage 
            ? `linear-gradient(rgba(0,0,0,0.3), rgba(0,0,0,0.3)), url(${backgroundImage})`
            : 'linear-gradient(135deg, #0f0f23 0%, #1a1a2e 25%, #16213e 50%, #0f3460 75%, #533483 100%)'};
          background-size: cover;
          background-position: center;
          background-attachment: fixed;
          min-height: 100vh;
          position: relative;
          color: ${backgroundImage ? (textColor === 'black' ? '#ffffff' : '#ffffff') : '#ffffff'};
        }
        
        .glass-overlay {
          background: rgba(255, 255, 255, 0.05);
          backdrop-filter: blur(20px);
          border: 1px solid rgba(255, 255, 255, 0.1);
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        }
        
        .video-container {
          border-radius: 16px;
          overflow: hidden;
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
          transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
          border: 2px solid rgba(255, 255, 255, 0.1);
          position: relative;
        }
        
        .video-container:hover {
          transform: translateY(-8px);
          box-shadow: 0 30px 60px rgba(0, 0, 0, 0.5);
          border-color: rgba(255, 255, 255, 0.2);
        }
        
        .pinned-video-container {
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          z-index: 1000;
          border-radius: 16px;
          overflow: hidden;
          box-shadow: 0 30px 60px rgba(0, 0, 0, 0.6);
          border: 3px solid rgba(255, 255, 255, 0.2);
          background: rgba(0, 0, 0, 0.9);
          backdrop-filter: blur(20px);
        }
        
        .resize-handle {
          position: absolute;
          bottom: 0;
          right: 0;
          width: 20px;
          height: 20px;
          background: linear-gradient(135deg, #6366f1, #8b5cf6);
          cursor: se-resize;
          border-radius: 16px 0 16px 0;
          opacity: 0.7;
          transition: opacity 0.3s ease;
        }
        
        .resize-handle:hover {
          opacity: 1;
        }
        
        .controls-bar {
          position: fixed;
          bottom: 30px;
          left: 50%;
          transform: translateX(-50%) translateX(${controlsPosition.x}px) translateY(${controlsPosition.y}px);
          display: flex;
          gap: 12px;
          padding: 16px 24px;
          background: rgba(0, 0, 0, 0.85);
          backdrop-filter: blur(30px);
          border-radius: 60px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          transition: ${isDragging ? 'none' : 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)'};
          z-index: 1100;
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.6);
          cursor: ${isDragging ? 'grabbing' : 'grab'};
          user-select: none;
        }
        
        .controls-bar:hover {
          box-shadow: 0 25px 50px rgba(0, 0, 0, 0.7);
        }
        
        .control-btn {
          width: 52px;
          height: 52px;
          border-radius: 50%;
          border: none;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 22px;
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          position: relative;
          overflow: hidden;
          font-family: 'Inter', sans-serif;
        }
        
        .control-btn::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: linear-gradient(45deg, transparent, rgba(255,255,255,0.1), transparent);
          transform: translateX(-100%);
          transition: transform 0.6s;
        }
        
        .control-btn:hover::before {
          transform: translateX(100%);
        }
        
        .control-btn:hover {
          transform: scale(1.15);
        }
        
        .control-btn.active {
          background: linear-gradient(135deg, #10b981, #059669);
          color: white;
          box-shadow: 0 8px 25px rgba(16, 185, 129, 0.4);
        }
        
        .control-btn.inactive {
          background: linear-gradient(135deg, #ef4444, #dc2626);
          color: white;
          box-shadow: 0 8px 25px rgba(239, 68, 68, 0.4);
        }
        
        .control-btn.neutral {
          background: rgba(255, 255, 255, 0.15);
          color: white;
          backdrop-filter: blur(10px);
        }
        
        .control-btn.end-call {
  background: linear-gradient(135deg, #ef4444, #dc2626);
  color: white;
  box-shadow: 0 8px 25px rgba(239, 68, 68, 0.4);
  position: relative;
  overflow: hidden;
}

.control-btn.end-call:hover {
  background: linear-gradient(135deg, #dc2626, #b91c1c);
  box-shadow: 0 12px 30px rgba(239, 68, 68, 0.6);
  transform: scale(1.1);
}

.control-btn.end-call:active {
  transform: scale(0.95);
}

.control-btn.end-call::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 0;
  height: 0;
  background: rgba(255, 255, 255, 0.3);
  border-radius: 50%;
  transform: translate(-50%, -50%);
  transition: all 0.3s ease;
}

.control-btn.end-call:hover::after {
  width: 100%;
  height: 100%;
}


        .control-btn.disabled {
  background: rgba(107, 114, 128, 0.5);
  color: rgba(255, 255, 255, 0.4);
  cursor: not-allowed;
  box-shadow: none;
}
.control-btn {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative;
  overflow: hidden;
  font-family: 'Inter', sans-serif;
  backdrop-filter: blur(10px);
}

.modern-btn {
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
}

.modern-btn::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(45deg, transparent, rgba(255,255,255,0.1), transparent);
  transform: translateX(-100%);
  transition: transform 0.6s;
}

.modern-btn:hover::before {
  transform: translateX(100%);
}

.modern-btn:hover {
  transform: scale(1.15);
  box-shadow: 0 8px 25px rgba(0, 0, 0, 0.3);
  border-color: rgba(255, 255, 255, 0.4);
}

.modern-btn:active {
  transform: scale(0.95);
}

.btn-icon {
  font-size: 22px;
  z-index: 1;
  position: relative;
}

.modern-btn.active {
  background: linear-gradient(135deg, #10b981, #059669);
  color: white;
  box-shadow: 0 8px 25px rgba(16, 185, 129, 0.4);
  border-color: rgba(16, 185, 129, 0.6);
}

.modern-btn.active:hover {
  background: linear-gradient(135deg, #059669, #047857);
  box-shadow: 0 12px 30px rgba(16, 185, 129, 0.6);
}

.modern-btn.inactive {
  background: linear-gradient(135deg, #ef4444, #dc2626);
  color: white;
  box-shadow: 0 8px 25px rgba(239, 68, 68, 0.4);
  border-color: rgba(239, 68, 68, 0.6);
}

.modern-btn.inactive:hover {
  background: linear-gradient(135deg, #dc2626, #b91c1c);
  box-shadow: 0 12px 30px rgba(239, 68, 68, 0.6);
}

.modern-btn.neutral {
  background: rgba(255, 255, 255, 0.15);
  color: white;
  border-color: rgba(255, 255, 255, 0.3);
}

.modern-btn.neutral:hover {
  background: rgba(255, 255, 255, 0.25);
  border-color: rgba(255, 255, 255, 0.5);
}

.modern-btn.disabled {
  background: rgba(107, 114, 128, 0.3);
  color: rgba(255, 255, 255, 0.3);
  cursor: not-allowed;
  box-shadow: none;
  border-color: rgba(107, 114, 128, 0.3);
}

.modern-btn.disabled:hover {
  transform: none;
  box-shadow: none;
  background: rgba(107, 114, 128, 0.3);
  border-color: rgba(107, 114, 128, 0.3);
}

.modern-btn.disabled::before {
  display: none;
}

.modern-btn.end-call {
  background: linear-gradient(135deg, #ef4444, #dc2626);
  color: white;
  box-shadow: 0 8px 25px rgba(239, 68, 68, 0.4);
  border-color: rgba(239, 68, 68, 0.6);
}

.modern-btn.end-call:hover {
  background: linear-gradient(135deg, #dc2626, #b91c1c);
  box-shadow: 0 12px 30px rgba(239, 68, 68, 0.6);
  transform: scale(1.1);
}

.modern-btn.end-call::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 0;
  height: 0;
  background: rgba(255, 255, 255, 0.3);
  border-radius: 50%;
  transform: translate(-50%, -50%);
  transition: all 0.3s ease;
}

.modern-btn.end-call:hover::after {
  width: 100%;
  height: 100%;
}

.hide-controls-btn.modern-hide-btn {
  position: fixed;
  bottom: 30px;
  left: 50%;
  transform: translateX(-50%);
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.8);
  backdrop-filter: blur(30px);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: white;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  z-index: 1100;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
}

.hide-controls-btn.modern-hide-btn:hover {
  transform: translateX(-50%) scale(1.1);
  box-shadow: 0 25px 50px rgba(0, 0, 0, 0.7);
  border-color: rgba(255, 255, 255, 0.4);
}

.hide-controls-btn.modern-hide-btn .btn-icon {
  font-size: 24px;
}
        
        .chat-container {
          background: ${chatDarkMode
            ? 'linear-gradient(135deg, rgba(15, 15, 35, 0.95) 0%, rgba(26, 26, 46, 0.95) 100%)'
            : 'linear-gradient(135deg, rgba(248, 250, 252, 0.95) 0%, rgba(241, 245, 249, 0.95) 100%)'};
          color: ${chatDarkMode ? '#f1f5f9' : '#1e293b'};
          border-radius: 24px 0 0 24px;
          box-shadow: -20px 0 40px rgba(0, 0, 0, 0.3);
          backdrop-filter: blur(20px);
          border: 1px solid ${chatDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'};
        }
        
        .message-bubble {
          max-width: 85%;
          padding: 14px 18px;
          border-radius: 20px;
          margin-bottom: 10px;
          word-wrap: break-word;
          animation: slideIn 0.4s cubic-bezier(0.4, 0, 0.2, 1);
          font-weight: 400;
          line-height: 1.4;
        }
        
        .message-sender {
          background: linear-gradient(135deg, #6366f1, #8b5cf6);
          color: white;
          align-self: flex-start;
          border-bottom-left-radius: 8px;
          box-shadow: 0 4px 15px rgba(99, 102, 241, 0.3);
        }
        
        .message-receiver {
          background: ${chatDarkMode ? 'rgba(51, 65, 85, 0.8)' : 'rgba(255, 255, 255, 0.9)'};
          color: ${chatDarkMode ? '#f1f5f9' : '#1e293b'};
          align-self: flex-end;
          border-bottom-right-radius: 8px;
          box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
          backdrop-filter: blur(10px);
        }
        
        .chat-input-container {
          background: ${chatDarkMode ? 'rgba(30, 41, 59, 0.8)' : 'rgba(255, 255, 255, 0.9)'};
          backdrop-filter: blur(20px);
          border-radius: 24px;
          padding: 20px;
          margin: 20px;
          border: 1px solid ${chatDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'};
        }
        
        .chat-input {
          background: ${chatDarkMode ? 'rgba(15, 23, 42, 0.8)' : 'rgba(255, 255, 255, 0.9)'};
          color: ${chatDarkMode ? '#f1f5f9' : '#1e293b'};
          border: 2px solid ${chatDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(226, 232, 240, 0.8)'};
          border-radius: 16px;
          padding: 14px 20px;
          outline: none;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          font-family: 'Inter', sans-serif;
          font-weight: 400;
        }
        
        .chat-input:focus {
          border-color: #6366f1;
          box-shadow: 0 0 0 4px rgba(99, 102, 241, 0.1);
          transform: translateY(-1px);
        }
        
        .emoji-animation {
          position: fixed;
          font-size: 32px;
          pointer-events: none;
          animation: emojiPop 2.5s cubic-bezier(0.4, 0, 0.2, 1) forwards;
          z-index: 1000;
        }
        
        .upload-status {
          position: fixed;
          top: 24px;
          right: 24px;
          padding: 12px 20px;
          border-radius: 12px;
          color: white;
          font-weight: 600;
          z-index: 1000;
          backdrop-filter: blur(20px);
          border: 1px solid rgba(255, 255, 255, 0.2);
          font-family: 'Inter', sans-serif;
        }
        
        .upload-status.uploading {
          background: linear-gradient(135deg, #f59e0b, #d97706);
          box-shadow: 0 8px 25px rgba(245, 158, 11, 0.4);
        }
        
        .upload-status.done {
          background: linear-gradient(135deg, #10b981, #059669);
          box-shadow: 0 8px 25px rgba(16, 185, 129, 0.4);
        }
        
        .local-video-overlay {
          position: fixed;
          bottom: 140px;
          right: 380px;
          width: 180px;
          height: 120px;
          border-radius: 16px;
          overflow: hidden;
          border: 3px solid rgba(255, 255, 255, 0.3);
          z-index: 50;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        
        .local-video-overlay:hover {
          transform: scale(1.05);
          border-color: rgba(255, 255, 255, 0.5);
        }
        
        .photo-dropdown {
  position: absolute;
  bottom: 100%;
  margin-bottom: 10px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.9);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 12px;
  box-shadow: 0 20px 40px rgba(0,0,0,0.4);
  overflow: hidden;
  z-index: 1200;
  min-width: 140px;
}

.photo-dropdown.nested {
  bottom: 0;
  left: 100%;
  transform: none;
  margin-left: 8px;
  margin-bottom: 0;
}
        
        .photo-dropdown button {
          display: block;
          width: 100%;
          padding: 12px 16px;
          border: none;
          background: none;
          text-align: left;
          cursor: pointer;
          color: white;
          font-size: 14px;
          font-weight: 500;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          font-family: 'Inter', sans-serif;
        }
        
        .photo-dropdown button:hover {
          background: rgba(99, 102, 241, 0.2);
          color: #a5b4fc;
        }
        
        .room-header {
          position: absolute;
          top: 24px;
          left: 24px;
          z-index: 50;
          color: white;
          text-shadow: 0 4px 20px rgba(0,0,0,0.8);
        }
        
        .room-title {
          margin: 0;
          font-size: 32px;
          font-weight: 700;
          background: linear-gradient(135deg, #a5b4fc, #c7d2fe, #ddd6fe);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          font-family: 'Inter', sans-serif;
          letter-spacing: -0.02em;
        }
        
        .room-status {
          margin: 8px 0 0 0;
          font-size: 14px;
          opacity: 0.9;
          font-weight: 500;
          font-family: 'JetBrains Mono', monospace;
        }
        
        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateY(20px) scale(0.95);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        
        @keyframes emojiPop {
          0% {
            opacity: 1;
            transform: scale(1) translateY(0) rotate(0deg);
          }
          25% {
            opacity: 1;
            transform: scale(1.3) translateY(-30px) rotate(5deg);
          }
          50% {
            opacity: 1;
            transform: scale(1.5) translateY(-60px) rotate(-5deg);
          }
          75% {
            opacity: 0.7;
            transform: scale(1.2) translateY(-90px) rotate(3deg);
          }
          100% {
            opacity: 0;
            transform: scale(0.8) translateY(-120px) rotate(0deg);
          }
        }
        
        @keyframes pulse {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: 0.7;
          }
        }
        
        .loading-pulse {
          animation: pulse 2s infinite;
        }
      `}</style>
      
      <div className="modern-container">
        {/* Animated Emojis */}
        {animatingEmojis.map(emoji => (
          <div
            key={emoji.id}
            className="emoji-animation"
            style={{
              left: `${emoji.x + 300}px`,
              top: `${emoji.y + 200}px`
            }}
          >
            {emoji.emoji}
          </div>
        ))}
        
        {/* Upload Status */}
        {Object.entries(uploadStatus).map(([id, status]) => (
          <div key={id} className={`upload-status ${status}`}>
            {status === 'uploading' ? '⬆️ Uploading...' : '✅ Upload Complete!'}
          </div>
        ))}
        
        {/* Room Header */}
        <div className="room-header">
          <h1 className="room-title">
            {roomName || `Room: ${roomId}`}
          </h1>
          <p className="room-status">
            {connectionState} {isHost && '(Host)'} {isCallActive && '– Active'}
            {!socketConnected && ' • Disconnected'}
          </p>
          {error && (
            <p style={{ 
              margin: '8px 0 0 0',
              fontSize: '14px',
              color: error.includes('✅') ? '#10b981' : '#fca5a5',
              background: error.includes('✅') ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)',
              padding: '8px 12px',
              borderRadius: '8px',
              backdropFilter: 'blur(10px)',
              border: error.includes('✅') ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(239, 68, 68, 0.3)',
              fontFamily: 'JetBrains Mono, monospace'
            }}>
              {error}
            </p>
          )}
        </div>
        
        {/* Pinned Video Mode */}
        {isPinned && peerJoined && (
          <div 
            className="pinned-video-container"
            style={{
              width: `${pinnedVideoSize.width}px`,
              height: `${pinnedVideoSize.height}px`
            }}
          >
            {screenSharingActive && remoteScreenStream ? (
              <video
                ref={pinnedRemoteScreenRef}
                autoPlay
                playsInline
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  background: '#000'
                }}
                onLoadedMetadata={() => {
                  if (pinnedRemoteScreenRef.current) {
                    pinnedRemoteScreenRef.current.play().catch(console.error);
                  }
                }}
              />
            ) : (
              <video
                ref={pinnedRemoteVideoRef}
                autoPlay
                playsInline
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  background: 'linear-gradient(135deg, #1e293b, #334155)'
                }}
                onLoadedMetadata={() => {
                  if (pinnedRemoteVideoRef.current) {
                    pinnedRemoteVideoRef.current.play().catch(console.error);
                  }
                }}
              />
            )}
            <div style={{
              position: 'absolute',
              bottom: '12px',
              left: '12px',
              background: 'rgba(0, 0, 0, 0.8)',
              color: 'white',
              padding: '6px 12px',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: '600',
              fontFamily: 'Inter, sans-serif'
            }}>
              {screenSharingActive ? `🖥️ ${peerName || 'Peer'}'s Screen` : `👤 ${peerName || 'Peer'}`}
            </div>
            <div 
              className="resize-handle"
              onMouseDown={handleResizeStart}
              title="Drag to resize"
            />
          </div>
        )}
        
        {/* Main Video Area - Hidden when pinned */}
        {!isPinned && (
          <div style={{
            display: 'flex',
            height: '100vh',
            padding: '24px',
            paddingBottom: '140px'
          }}>
            {/* Video Section */}
            <div style={{ 
              flex: 1,
              display: 'flex',
              gap: '24px',
              alignItems: 'center',
              marginRight: showMessaging ? '24px' : '0',
              transition: 'margin-right 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
            }}>
              {!peerJoined ? (
                // No peer joined - show two rectangular windows (one for local, one placeholder)
                <div style={{ flex: 1, display: 'flex', gap: '24px', justifyContent: 'center', alignItems: 'center' }}>
                  {/* Local Video */}
                  <div className="video-container" style={{ width: '45%', maxWidth: '500px' }}>
                    <video
                      ref={localVideoRef}
                      autoPlay
                      playsInline
                      muted
                      controls={false}
                      style={{
                        width: '100%',
                        height: '360px',
                        objectFit: 'cover',
                        background: 'linear-gradient(135deg, #1e293b, #334155)',
                        display: 'block' // Always show local video container
                      }}
                      onLoadedMetadata={(e) => {
                        console.log('Local video metadata loaded');
                        const video = e.currentTarget;
                        video.play().then(() => {
                          console.log('Local video started playing');
                        }).catch(error => {
                          console.error('Error playing local video:', error);
                          setTimeout(() => {
                            video.play().catch(console.error);
                          }, 100);
                        });
                      }}
                      onCanPlay={(e) => {
                        console.log('Local video can play');
                        e.currentTarget.play().catch(console.error);
                      }}
                      onError={(e) => {
                        console.error('Local video error:', e);
                      }}
                    />
                    {!videoEnabled && (
                      <div style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '100%',
                        background: 'linear-gradient(135deg, #374151, #4b5563)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#d1d5db',
                        fontSize: '48px'
                      }}>
                        📷
                      </div>
                    )}
                    <div style={{
                      position: 'absolute',
                      bottom: '12px',
                      left: '12px',
                      background: 'rgba(0, 0, 0, 0.8)',
                      color: 'white',
                      padding: '6px 12px',
                      borderRadius: '8px',
                      fontSize: '14px',
                      fontWeight: '600',
                      fontFamily: 'Inter, sans-serif'
                    }}>
                      📹 {userName} (You)
                    </div>
                  </div>
                  
                  {/* Waiting Placeholder */}
                  <div className="video-container" style={{ width: '45%', maxWidth: '500px' }}>
                    <div style={{
                      width: '100%',
                      height: '360px',
                      background: 'linear-gradient(135deg, #374151, #4b5563)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#d1d5db',
                      fontSize: '18px',
                      fontWeight: '500'
                    }}>
                      <div style={{ fontSize: '48px', marginBottom: '16px', opacity: 0.7 }} className="loading-pulse">
                        👥
                      </div>
                      <div>Waiting for peer to join...</div>
                      <div style={{ fontSize: '14px', opacity: 0.6, marginTop: '8px' }}>
                        Share the room ID to invite someone
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                // Peer joined - show based on screen sharing state
                <>
                  {screenSharingActive && remoteScreenStream ? (
                    // Screen sharing active - one big window covering entire screen
                    <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                      <div className="video-container" style={{
                        width: showMessaging ? '100%' : '100%',
                        maxWidth: showMessaging ? '100%' : '100%',
                        height: '80vh'
                      }}>
                        <video
                          ref={remoteScreenRef}
                          autoPlay
                          playsInline
                          style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'contain',
                            background: '#000'
                          }}
                          onLoadedMetadata={() => {
                            if (remoteScreenRef.current) {
                              remoteScreenRef.current.play().catch(console.error);
                            }
                          }}
                        />
                        <div style={{
                          position: 'absolute',
                          bottom: '12px',
                          left: '12px',
                          background: 'rgba(0, 0, 0, 0.8)',
                          color: 'white',
                          padding: '6px 12px',
                          borderRadius: '8px',
                          fontSize: '14px',
                          fontWeight: '600',
                          fontFamily: 'Inter, sans-serif'
                        }}>
                          🖥️ {peerName || 'Peer'}'s Screen
                        </div>
                      </div>
                    </div>
                  ) : (
                    // Normal video call - two rectangular windows
                    <div style={{ flex: 1, display: 'flex', gap: '24px', justifyContent: 'center', alignItems: 'center' }}>
                      {/* Local Video - Always show container */}
                      <div className="video-container" style={{ width: '45%', maxWidth: '500px' }}>
                        <video
                          ref={localVideoRef}
                          autoPlay
                          playsInline
                          muted
                          controls={false}
                          style={{
                            width: '100%',
                            height: '360px',
                            objectFit: 'cover',
                            background: 'linear-gradient(135deg, #1e293b, #334155)',
                            display: videoEnabled ? 'block' : 'none'
                          }}
                          onLoadedMetadata={(e) => {
                            console.log('Local video metadata loaded (peer joined)');
                            const video = e.currentTarget;
                            video.play().then(() => {
                              console.log('Local video started playing (peer joined)');
                            }).catch(error => {
                              console.error('Error playing local video (peer joined):', error);
                              setTimeout(() => {
                                video.play().catch(console.error);
                              }, 100);
                            });
                          }}
                          onCanPlay={(e) => {
                            console.log('Local video can play (peer joined)');
                            e.currentTarget.play().catch(console.error);
                          }}
                          onError={(e) => {
                            console.error('Local video error (peer joined):', e);
                          }}
                        />
                        {!videoEnabled && (
                          <div style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: '100%',
                            height: '100%',
                            background: 'linear-gradient(135deg, #374151, #4b5563)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#d1d5db',
                            fontSize: '48px'
                          }}>
                            📷
                          </div>
                        )}
                        <div style={{
                          position: 'absolute',
                          bottom: '12px',
                          left: '12px',
                          background: 'rgba(0, 0, 0, 0.8)',
                          color: 'white',
                          padding: '6px 12px',
                          borderRadius: '8px',
                          fontSize: '14px',
                          fontWeight: '600',
                          fontFamily: 'Inter, sans-serif'
                        }}>
                          📹 {userName} (You)
                        </div>
                      </div>
                      
                      {/* Remote Video */}
                      <div className="video-container" style={{ width: '45%', maxWidth: '500px' }}>
                        <video
                          ref={remoteVideoRef}
                          autoPlay
                          playsInline
                          style={{
                            width: '100%',
                            height: '360px',
                            objectFit: 'cover',
                            background: 'linear-gradient(135deg, #1e293b, #334155)'
                          }}
                          onLoadedMetadata={() => {
                            if (remoteVideoRef.current) {
                              remoteVideoRef.current.play().catch(console.error);
                            }
                          }}
                        />
                        <div style={{
                          position: 'absolute',
                          bottom: '12px',
                          left: '12px',
                          background: 'rgba(0, 0, 0, 0.8)',
                          color: 'white',
                          padding: '6px 12px',
                          borderRadius: '8px',
                          fontSize: '14px',
                          fontWeight: '600',
                          fontFamily: 'Inter, sans-serif'
                        }}>
                          👤 {peerName || 'Peer'}
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
            
            {/* Chat Sidebar */}
            {showMessaging && (
              <div className="chat-container" style={{
                width: '380px',
                display: 'flex',
                flexDirection: 'column',
                position: 'relative',
                transform: showMessaging ? 'translateX(0)' : 'translateX(100%)',
                transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
              }}>
                {/* Chat Header */}
                <div style={{
                  padding: '24px',
                  borderBottom: `1px solid ${chatDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'}`,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}>
                  <h3 style={{ 
                    margin: 0,
                    fontSize: '20px',
                    fontWeight: '700',
                    fontFamily: 'Inter, sans-serif',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}>
                    💬 Chat
                  </h3>
                  <button
                    onClick={() => setChatDarkMode(!chatDarkMode)}
                    style={{
                      background: 'none',
                      border: 'none',
                      fontSize: '22px',
                      cursor: 'pointer',
                      padding: '8px',
                      borderRadius: '50%',
                      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                      background: chatDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'
                    }}
                    title="Toggle dark mode"
                  >
                    {chatDarkMode ? '☀️' : '🌙'}
                  </button>
                </div>
                
                {/* Messages */}
                <div style={{
                  flex: 1,
                  overflowY: 'auto',
                  padding: '24px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px'
                }}>
                  {messages.map((msg, index) => {
                    const isOwnMessage = msg.sender === socket.id;
                    return (
                      <div key={index} style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: isOwnMessage ? 'flex-start' : 'flex-end'
                      }}>
                        <small style={{
                          color: chatDarkMode ? '#94a3b8' : '#64748b',
                          fontSize: '12px',
                          marginBottom: '6px',
                          paddingLeft: isOwnMessage ? '18px' : '0',
                          paddingRight: isOwnMessage ? '0' : '18px',
                          fontFamily: 'JetBrains Mono, monospace',
                          fontWeight: '500'
                        }}>
                          {isOwnMessage ? userName : (peerName || 'Peer')} •{' '}
                          {new Date(msg.timestamp).toLocaleTimeString()}
                        </small>
                        <div className={`message-bubble ${isOwnMessage ? 'message-sender' : 'message-receiver'}`}>
                          {msg.type === 'text' && <span>{msg.message}</span>}
                          {msg.type === 'image' && (
                            <img
                              src={msg.message || "/placeholder.svg"}
                              alt="uploaded content"
                              style={{
                                maxWidth: '100%',
                                borderRadius: '12px',
                                cursor: 'pointer',
                                transition: 'transform 0.3s ease'
                              }}
                              onClick={() => window.open(msg.message, '_blank')}
                              onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.02)'}
                              onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                            />
                          )}
                          {msg.type === 'gif' && (
                            <img
                              src={msg.message || "/placeholder.svg"}
                              alt="gif"
                              style={{
                                maxWidth: '100%',
                                borderRadius: '12px',
                                cursor: 'pointer',
                                transition: 'transform 0.3s ease'
                              }}
                              onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.02)'}
                              onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                            />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                
                {/* Chat Input */}
                <div className="chat-input-container">
                  <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', justifyContent: 'center' }}>
                    <button
                      onClick={() => setShowEmojiPicker(prev => !prev)}
                      style={{
                        background: showEmojiPicker ? 'rgba(99, 102, 241, 0.2)' : 'rgba(255, 255, 255, 0.1)',
                        border: 'none',
                        fontSize: '24px',
                        cursor: 'pointer',
                        padding: '10px',
                        borderRadius: '12px',
                        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                        backdropFilter: 'blur(10px)'
                      }}
                      title="Add emoji"
                    >
                      😊
                    </button>
                    <button
                      onClick={() => setShowGifPicker(prev => !prev)}
                      style={{
                        background: showGifPicker ? 'rgba(99, 102, 241, 0.2)' : 'rgba(255, 255, 255, 0.1)',
                        border: 'none',
                        fontSize: '14px',
                        cursor: 'pointer',
                        padding: '10px 16px',
                        borderRadius: '12px',
                        fontWeight: '600',
                        color: chatDarkMode ? '#f1f5f9' : '#1e293b',
                        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                        fontFamily: 'Inter, sans-serif',
                        backdropFilter: 'blur(10px)'
                      }}
                      title="Add GIF"
                    >
                      GIF
                    </button>
                    <label style={{
                      cursor: 'pointer',
                      fontSize: '24px',
                      padding: '10px',
                      borderRadius: '12px',
                      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: 'rgba(255, 255, 255, 0.1)',
                      backdropFilter: 'blur(10px)'
                    }} title="Upload image">
                      📷
                      <input
                        type="file"
                        accept="image/*"
                        style={{ display: 'none' }}
                        onChange={sendImage}
                      />
                    </label>
                  </div>
                  
                  <div style={{ display: 'flex', gap: '12px' }}>
                    <input
                      className="chat-input"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && sendText()}
                      placeholder="Type a message…"
                      style={{ flex: 1 }}
                      disabled={!socketConnected}
                    />
                    <button
                      onClick={sendText}
                      disabled={!socketConnected}
                      style={{
                        background: socketConnected ? 'linear-gradient(135deg, #6366f1, #8b5cf6)' : 'rgba(156, 163, 175, 0.5)',
                        color: 'white',
                        border: 'none',
                        padding: '14px 24px',
                        borderRadius: '16px',
                        cursor: socketConnected ? 'pointer' : 'not-allowed',
                        fontWeight: '600',
                        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                        fontFamily: 'Inter, sans-serif',
                        boxShadow: socketConnected ? '0 4px 15px rgba(99, 102, 241, 0.3)' : 'none'
                      }}
                      onMouseEnter={(e) => socketConnected && (e.currentTarget.style.transform = 'translateY(-1px)')}
                      onMouseLeave={(e) => socketConnected && (e.currentTarget.style.transform = 'translateY(0)')}
                    >
                      Send
                    </button>
                  </div>
                  
                  {/* Emoji Picker */}
                  {showEmojiPicker && (
                    <div style={{
                      position: 'absolute',
                      bottom: '140px',
                      right: '24px',
                      zIndex: 1000,
                      boxShadow: '0 20px 40px rgba(0,0,0,0.4)',
                      borderRadius: '16px',
                      overflow: 'hidden',
                      border: '1px solid rgba(255, 255, 255, 0.1)'
                    }}>
                      <EmojiPicker onEmojiClick={onEmojiClick} />
                    </div>
                  )}
                  
                  {/* GIF Picker */}
                  {showGifPicker && (
                    <div style={{
                      position: 'absolute',
                      bottom: '140px',
                      right: '24px',
                      width: '320px',
                      maxHeight: '400px',
                      background: chatDarkMode ? 'rgba(15, 23, 42, 0.95)' : 'rgba(255, 255, 255, 0.95)',
                      border: `1px solid ${chatDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'}`,
                      borderRadius: '16px',
                      boxShadow: '0 20px 40px rgba(0,0,0,0.4)',
                      overflowY: 'auto',
                      padding: '20px',
                      zIndex: 1000,
                      backdropFilter: 'blur(20px)'
                    }}>
                      <div style={{ display: 'flex', marginBottom: '16px', gap: '10px' }}>
                        <input
                          value={gifQuery}
                          onChange={(e) => setGifQuery(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && fetchGiphyGifs()}
                          placeholder="Search GIFs…"
                          style={{
                            flex: 1,
                            padding: '12px 16px',
                            border: `2px solid ${chatDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(226, 232, 240, 0.8)'}`,
                            borderRadius: '12px',
                            fontSize: '14px',
                            background: chatDarkMode ? 'rgba(30, 41, 59, 0.8)' : 'rgba(248, 250, 252, 0.8)',
                            color: chatDarkMode ? '#f1f5f9' : '#1e293b',
                            outline: 'none',
                            fontFamily: 'Inter, sans-serif',
                            transition: 'all 0.3s ease'
                          }}
                        />
                        <button
                          onClick={fetchGiphyGifs}
                          style={{
                            background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                            color: 'white',
                            border: 'none',
                            padding: '12px 20px',
                            borderRadius: '12px',
                            fontSize: '14px',
                            cursor: 'pointer',
                            fontWeight: '600',
                            fontFamily: 'Inter, sans-serif',
                            boxShadow: '0 4px 15px rgba(99, 102, 241, 0.3)'
                          }}
                        >
                          Search
                        </button>
                      </div>
                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: '10px'
                      }}>
                        {gifResults.map((url, index) => (
                          <img
                            key={index}
                            src={url || "/placeholder.svg"}
                            alt={`GIF ${index + 1}`}
                            onClick={() => sendGif(url)}
                            style={{
                              width: '100%',
                              cursor: 'pointer',
                              borderRadius: '10px',
                              transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
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
            )}
          </div>
        )}
        
        {/* Local Video Overlay (only during screen sharing) */}
        {screenSharingActive && remoteScreenStream && !isPinned && (
          <div className="local-video-overlay">
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              controls={false}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover'
              }}
            />
            <div style={{
              position: 'absolute',
              bottom: '4px',
              left: '4px',
              background: 'rgba(0, 0, 0, 0.8)',
              color: 'white',
              padding: '2px 6px',
              borderRadius: '4px',
              fontSize: '10px',
              fontWeight: '600'
            }}>
              You
            </div>
          </div>
        )}
        
        {/* Controls */}
        {controlsVisible ? (
          <div 
  ref={controlsRef}
  className="controls-bar"
  onMouseDown={handleControlsDragStart}
>
  <button
    className={`control-btn modern-btn ${audioEnabled ? 'active' : 'inactive'}`}
    onClick={toggleAudio}
    title={audioEnabled ? 'Mute' : 'Unmute'}
    >
    <span className="btn-icon">{audioEnabled ? '🎤' : '🔇'}</span>
  </button>
  
  <button
    className={`control-btn modern-btn ${videoEnabled ? 'active' : 'inactive'}`}
    onClick={toggleVideo}
    title={videoEnabled ? 'Turn off video' : 'Turn on video'}
    >
    <span className="btn-icon">{videoEnabled ? '📹' : '📷'}</span>
  </button>
  
  <button
    className={`control-btn modern-btn ${isSharingLocal ? 'active' : 'neutral'}`}
    onClick={isSharingLocal ? stopScreenShare : shareScreen}
    disabled={screenSharingActive && !isSharingLocal}
    title={isSharingLocal ? 'Stop sharing' : 'Share screen'}
    >
    <span className="btn-icon">🖥️</span>
  </button>
  
  <button
    className="control-btn modern-btn neutral"
    onClick={copyRoomId}
    title="Copy room ID"
    >
    <span className="btn-icon">📋</span>
  </button>
  
  {/* Photo dropdown wrapper */}
  <div style={{ position: 'relative' }}>
    <button
      className={`control-btn modern-btn ${isPinned ? 'disabled' : 'neutral'}`}
      onClick={() => {
        if (!isPinned) {
          setShowPhotoMenu(p => !p);
          setShowBoothMenu(false);
        }
      }}
      disabled={isPinned}
      title={isPinned ? "Photo disabled while pinned" : "Take photo"}
      >
      <span className="btn-icon">📸</span>
    </button>
    {showPhotoMenu && (
      <div className="photo-dropdown">
        <button onClick={handleWindowPhoto}>📷 Normal Photo</button>
        <button onClick={() => setShowBoothMenu(b => !b)}>🎭 Photobooth ▶</button>
      </div>
    )}
    {showBoothMenu && (
      <div className="photo-dropdown nested">
        {['normal', 'contrast', 'vintage', 'hue', 'old', 'bw'].map(style => (
          <button key={style} onClick={() => handleBoothPhoto(style)}>
            {style === 'normal' ? '🎨' : style === 'contrast' ? '🔆' : style === 'vintage' ? '📸' : style === 'hue' ? '🌈' : style === 'old' ? '⏳' : '⚫'} {style.charAt(0).toUpperCase() + style.slice(1)}
          </button>
        ))}
      </div>
    )}
  </div>
  
  {/* Pin Video Button */}
  <button
    className={`control-btn modern-btn ${isPinned ? 'active' : 'neutral'}`}
    onClick={togglePinVideo}
    title={isPinned ? 'Unpin video' : 'Pin video'}
    disabled={!peerJoined}
    >
    <span className="btn-icon">📌</span>
  </button>
  
  <button
    className={`control-btn modern-btn ${isPinned ? 'disabled' : (showMessaging ? 'active' : 'neutral')}`}
    onClick={() => {
      if (!isPinned) {
        setShowMessaging(prev => !prev);
      }
    }}
    disabled={isPinned}
    title={isPinned ? "Messaging disabled while pinned" : (showMessaging ? 'Hide messaging' : 'Show messaging')}
    >
    <span className="btn-icon">💬</span>
  </button>
  
  <button
    className="control-btn modern-btn neutral"
    onClick={() => setShowSettings(true)}
    title="Settings"
    >
    <span className="btn-icon">⚙️</span>
  </button>
  
  <button
    className="control-btn modern-btn end-call"
    onClick={handleEndCall}
    title="End meeting"
    >
    <span className="btn-icon" style={{ fontSize: '18px' }}>✕</span>
  </button>
  
  <button
    className="control-btn modern-btn neutral"
    onClick={() => setControlsVisible(false)}
    title="Hide controls"
    >
    <span className="btn-icon">⬇️</span>
  </button>
</div>
        ) : (
          <button
  className="hide-controls-btn modern-hide-btn"
  onClick={() => setControlsVisible(true)}
  title="Show controls"
  >
  <span className="btn-icon">⬆️</span>
</button>
        )}
        
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
              backgroundColor: 'rgba(0,0,0,0.8)',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              zIndex: 2000,
              backdropFilter: 'blur(20px)'
            }}
            >
            <div
              onClick={e => e.stopPropagation()}
              style={{
                backgroundColor: 'rgba(255, 255, 255, 0.95)',
                backdropFilter: 'blur(20px)',
                padding: '40px',
                borderRadius: '24px',
                boxShadow: '0 30px 60px rgba(0,0,0,0.4)',
                maxWidth: '600px',
                width: '90%',
                border: '1px solid rgba(255, 255, 255, 0.2)'
              }}
              >
              <h2 style={{ 
                margin: '0 0 30px 0',
                color: '#1e293b',
                fontSize: '28px',
                fontWeight: '700',
                fontFamily: 'Inter, sans-serif',
                display: 'flex',
                alignItems: 'center',
                gap: '12px'
              }}>
                ⚙️ Settings
              </h2>
              <div style={{ marginBottom: '24px' }}>
                <label style={{
                  display: 'block',
                  marginBottom: '12px',
                  color: '#374151',
                  fontWeight: '600',
                  fontSize: '16px',
                  fontFamily: 'Inter, sans-serif'
                }}>
                  🖼️ Upload Background Image:
                </label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleBackgroundUpload}
                  style={{
                    display: 'block',
                    width: '100%',
                    padding: '16px',
                    border: '2px dashed #d1d5db',
                    borderRadius: '12px',
                    backgroundColor: '#f9fafb',
                    cursor: 'pointer',
                    transition: 'all 0.3s ease',
                    fontFamily: 'Inter, sans-serif'
                  }}
                  />
                <small style={{
                  color: '#6b7280',
                  fontSize: '14px',
                  marginTop: '10px',
                  display: 'block',
                  lineHeight: 1.5,
                  fontFamily: 'Inter, sans-serif'
                }}>
                  This will sync the background for both participants. The image will be analyzed to adjust text colors automatically.
                </small>
              </div>
              <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => setShowSettings(false)}
                  style={{
                    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                    color: 'white',
                    border: 'none',
                    padding: '14px 28px',
                    borderRadius: '12px',
                    cursor: 'pointer',
                    fontWeight: '600',
                    fontSize: '16px',
                    fontFamily: 'Inter, sans-serif',
                    boxShadow: '0 4px 15px rgba(99, 102, 241, 0.3)',
                    transition: 'all 0.3s ease'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-1px)'}
                  onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}
                  >
                  Close
                </button>
              </div>
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
            backgroundColor: 'rgba(0,0,0,0.9)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 2000,
            backdropFilter: 'blur(30px)'
          }}>
            <div style={{
              backgroundColor: 'rgba(255, 255, 255, 0.95)',
              backdropFilter: 'blur(20px)',
              padding: '60px',
              borderRadius: '32px',
              textAlign: 'center',
              boxShadow: '0 40px 80px rgba(0,0,0,0.4)',
              maxWidth: '600px',
              animation: 'slideIn 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
              border: '1px solid rgba(255, 255, 255, 0.2)'
            }}>
              <div style={{ fontSize: '72px', marginBottom: '30px' }}>👋</div>
              <h2 style={{ 
                marginBottom: '30px',
                color: '#1e293b',
                fontSize: '32px',
                fontWeight: '700',
                fontFamily: 'Inter, sans-serif'
              }}>
                Meeting Ended
              </h2>
              <p style={{ 
                marginBottom: '30px',
                fontSize: '18px',
                lineHeight: 1.6,
                color: '#64748b',
                fontFamily: 'Inter, sans-serif'
              }}>
                {endDialogMessage}
              </p>
              <p style={{
                color: '#6366f1',
                fontSize: '22px',
                fontWeight: '600',
                marginBottom: 0,
                fontFamily: 'JetBrains Mono, monospace'
              }}>
                Returning to home page in {countdown} seconds...
              </p>
            </div>
          </div>
        )}
        
        {/* Photo Reel Display */}
        {photoReels.length > 0 && (
          <div style={{
            position: 'fixed',
            bottom: '24px',
            left: '24px',
            display: 'flex',
            gap: '12px',
            maxWidth: '600px',
            flexWrap: 'wrap',
            zIndex: 50,
          }}>
            <div style={{ position: 'relative' }}>
              {photoReels.map((src, idx) => (
                <img
                  key={idx}
                  src={src || "/placeholder.svg"}
                  alt={`Photo ${idx + 1}`}
                  style={{
                    width: '140px',
                    height: '100px',
                    objectFit: 'cover',
                    marginRight: '12px',
                    borderRadius: '12px',
                    boxShadow: '0 8px 25px rgba(0,0,0,0.4)',
                    cursor: 'pointer',
                    transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                    border: '2px solid rgba(255, 255, 255, 0.2)'
                  }}
                  onClick={() => window.open(src, '_blank')}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'scale(1.05) translateY(-4px)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'scale(1) translateY(0)';
                  }}
                  />
              ))}
              <button
                onClick={() => setPhotoReels([])}
                style={{
                  position: 'absolute',
                  top: '-12px',
                  right: '-12px',
                  background: 'linear-gradient(135deg, #ef4444, #dc2626)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '50%',
                  width: '32px',
                  height: '32px',
                  cursor: 'pointer',
                  fontSize: '16px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 4px 15px rgba(239, 68, 68, 0.4)',
                  transition: 'all 0.3s ease',
                  fontWeight: 'bold'
                }}
                onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.1)'}
                onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
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
