// pages/index.tsx
import { useState, type KeyboardEvent } from 'react';
import { useRouter } from 'next/router';
import { v4 as uuidv4 } from 'uuid';
import Head from 'next/head';

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

  const handleKeyPress = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleJoinRoom();
  };

  return (
    <>
      <Head>
        <title>Jam Jiggle</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap"
          rel="stylesheet"
        />
      </Head>

      <style jsx>{`
        * {
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
        }

        .main-container {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          position: relative;
          overflow: hidden;

          /* Vibrant multi-layered background (kept from earlier) */
          background:
            radial-gradient(1200px circle at 12% 10%, rgba(14,165,233,0.35) 0%, transparent 40%),
            radial-gradient(1000px circle at 88% 15%, rgba(139,92,246,0.35) 0%, transparent 45%),
            radial-gradient(900px circle at 20% 90%, rgba(249,115,22,0.35) 0%, transparent 45%),
            linear-gradient(135deg, #0ea5e9 0%, #6366f1 25%, #a855f7 50%, #ec4899 75%, #f97316 100%);
        }

        /* crisp grid overlay */
        .main-container::after {
          content: '';
          position: absolute;
          inset: 0;
          background:
            repeating-linear-gradient(
              90deg,
              rgba(255,255,255,0.05) 0px,
              rgba(255,255,255,0.05) 1px,
              transparent 1px,
              transparent 6px
            ),
            repeating-linear-gradient(
              0deg,
              rgba(255,255,255,0.05) 0px,
              rgba(255,255,255,0.05) 1px,
              transparent 1px,
              transparent 6px
            );
          pointer-events: none;
          mix-blend-mode: soft-light;
          opacity: 0.35;
        }

        .hero-section {
          text-align: center;
          margin-bottom: 48px;
          z-index: 1;
          position: relative;
          animation: fadeInUp 0.8s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .main-title {
          font-size: 4.5rem;
          font-weight: 900;
          margin-bottom: 16px;
          background: linear-gradient(90deg, #ffffff, #e0e7ff, #fde68a);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          letter-spacing: -0.02em;
          line-height: 1.06;
          text-shadow: 0 10px 30px rgba(0,0,0,0.25);
          filter: drop-shadow(0 4px 10px rgba(0,0,0,0.2));
        }

        .subtitle {
          font-size: 1.4rem;
          color: rgba(255, 255, 255, 0.98);
          font-weight: 700;
          margin-bottom: 10px;
          letter-spacing: 0.2px;
          text-shadow: 0 4px 14px rgba(0,0,0,0.35);
        }

        .description {
          font-size: 1.125rem;
          color: rgba(255, 255, 255, 0.85);
          font-weight: 500;
          text-shadow: 0 3px 12px rgba(0,0,0,0.35);
        }

        .card-container {
          background: rgba(255, 255, 255, 0.15);
          backdrop-filter: blur(25px);
          border: 2px solid rgba(255, 255, 255, 0.25);
          border-radius: 28px;
          padding: 48px;
          width: 100%;
          max-width: 520px;
          box-shadow:
            0 25px 50px rgba(0, 0, 0, 0.25),
            0 0 0 1px rgba(255, 255, 255, 0.1) inset,
            0 2px 4px rgba(255, 255, 255, 0.1) inset;
          z-index: 1;
          position: relative;
          transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
          animation: slideInScale 0.8s cubic-bezier(0.4, 0, 0.2, 1) 0.2s both;
          box-sizing: border-box;
        }

        .card-container:hover {
          transform: translateY(-12px);
          box-shadow:
            0 35px 70px rgba(0, 0, 0, 0.3),
            0 0 0 1px rgba(255, 255, 255, 0.2) inset,
            0 2px 4px rgba(255, 255, 255, 0.2) inset;
          border-color: rgba(255, 255, 255, 0.35);
        }

        .section-title {
          font-size: 1.25rem;
          font-weight: 800;
          color: rgba(255, 255, 255, 0.95);
          margin-bottom: 24px;
          text-align: center;
          letter-spacing: 0.02em;
          text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
          text-transform: uppercase;
        }

        .create-section { margin-bottom: 32px; text-align: center; }
        .join-section { margin-bottom: 0; }

        /* --- UNIFIED: shared purple/blue gradient for ALL three elements --- */
        .shared-pill {
          width: 100%;
          padding: 18px 28px;
          border-radius: 18px;
          color: #fff;
          background: linear-gradient(135deg, #8b5cf6 0%, #6366f1 50%, #0ea5e9 100%);
          border: none;
          box-shadow:
            0 12px 30px rgba(79, 70, 229, 0.45),
            inset 0 1px 0 rgba(255, 255, 255, 0.2);
          transition: transform .25s ease, box-shadow .25s ease, filter .25s ease;
          font-size: 17px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: .5px;
          margin-bottom: 16px;
          box-sizing: border-box;
          max-width: 100%;
        }

        .shared-pill:hover {
          transform: translateY(-3px);
          box-shadow: 0 18px 44px rgba(79, 70, 229, 0.55);
          filter: brightness(1.04);
        }
        .shared-pill:active { transform: translateY(-1px); }

        /* Create Room Button - uses shared-pill as base */
        .button-primary {
          cursor: pointer;
          position: relative;
          overflow: hidden;
        }
        .button-primary::before {
          content: '';
          position: absolute; 
          inset: 0;
          background: linear-gradient(45deg, transparent, rgba(255,255,255,0.3), transparent);
          transform: translateX(-100%); 
          transition: transform 0.6s;
        }
        .button-primary:hover::before { transform: translateX(100%); }

        /* Input Field - uses shared-pill as base */
        .room-input {
          background: transparent;
          outline: none;
          font-weight: 700;
          text-transform: none;
          box-sizing: border-box;
          max-width: 100%;
          width: 100%;
        }
        .room-input::placeholder {
          color: rgba(255,255,255,0.9);
          font-weight: 600;
          text-transform: none;
        }
        .room-input:focus {
          box-shadow: 0 0 0 6px rgba(99,102,241,0.25);
        }

        /* Join Room Button - uses shared-pill as base */
        .button-secondary {
          background: transparent;
          cursor: pointer;
        }
        .button-secondary:disabled {
          opacity: .6;
          cursor: not-allowed;
          transform: none;
          box-shadow: 0 12px 30px rgba(79, 70, 229, 0.45);
          filter: none;
        }
        .button-secondary:disabled:hover {
          transform: none;
          box-shadow: 0 12px 30px rgba(79, 70, 229, 0.45);
          filter: none;
        }

        .divider {
          display: flex; 
          align-items: center;
          margin: 40px 0;
          color: rgba(255, 255, 255, 0.8);
          font-size: 15px; 
          font-weight: 700;
        }
        .divider::before,
        .divider::after {
          content: '';
          flex: 1; 
          height: 2px;
          background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.3), transparent);
        }
        .divider span {
          padding: 10px 20px;
          background: rgba(255, 255, 255, 0.15);
          border-radius: 25px;
          backdrop-filter: blur(15px);
          border: 1px solid rgba(255, 255, 255, 0.2);
          text-transform: uppercase; 
          letter-spacing: 1px;
        }

        .card-credit {
          margin-top: 28px;
          text-align: center;
          font-size: 15px;
          font-weight: 700;
          color: rgba(255,255,255,0.9);
          letter-spacing: 0.6px;
          animation: fadeInUp 0.6s ease both 0.2s;
        }
        .card-credit a.card-credit-link {
          text-decoration: none;
          background: linear-gradient(90deg, #fff, #fde68a, #fca5a5);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          font-weight: 900;
          position: relative;
        }
        .card-credit a.card-credit-link::after {
          content: '';
          position: absolute; 
          left: 0; 
          bottom: -3px;
          width: 0; 
          height: 2px;
          background: linear-gradient(90deg, #fff, #fde68a, #fca5a5);
          transition: width 0.3s ease;
          border-radius: 2px;
        }
        .card-credit a.card-credit-link:hover::after { width: 100%; }

        @media (max-width: 640px) {
          .main-title { font-size: 3rem; }
          .card-container { margin: 0 20px; padding: 36px 28px; }
          .subtitle { font-size: 1.25rem; }
          .description { font-size: 1rem; }
        }

        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(40px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes slideInScale {
          from { opacity: 0; transform: translateY(30px) scale(0.95); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>

      <div className="main-container">
        <div className="hero-section">
          <h1 className="main-title">Jam Jiggle</h1>
          <p className="subtitle">Video Call for 2 people</p>
        </div>

        <div className="card-container">
          <div className="create-section">
            <h2 className="section-title"> Start a New Meeting</h2>
            <button onClick={handleCreateRoom} className="button-primary shared-pill">
              Create New Room
            </button>
          </div>

          <div className="divider">
            <span>or</span>
          </div>

          <div className="join-section">
            <h2 className="section-title">🔗 Join Existing Room</h2>

            <input
              type="text"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value)}
              onKeyDown={handleKeyPress}
              placeholder="Enter room code..."
              className="room-input shared-pill"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />

            <button
              onClick={handleJoinRoom}
              className="button-secondary shared-pill"
              disabled={!roomCode.trim()}
            >
              JOIN ROOM
            </button>
          </div>

          <div className="card-credit">
            crafted by{' '}
            <a
              href="https://linktr.ee/_shounakchandra"
              target="_blank"
              rel="noopener noreferrer"
              className="card-credit-link"
            >
              Shounak
            </a>
          </div>
        </div>
      </div>
    </>
  );
}