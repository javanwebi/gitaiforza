import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  Maximize,
  EyeOff,
  Eye,
  SlidersHorizontal,
  Mic,
  PhoneOff,
} from 'lucide-react';
import { ParticleHumanoid } from './ParticleHumanoid';
import { Button } from './Button';
import './style.css';

interface AiForzaCallExperienceProps {
  onClose?: () => void;
}

type ForzaStatus = 'idle' | 'listening' | 'thinking' | 'speaking';

const GREETING_TEXT = 'من هوش مصنوعی فورزا، مشاور فنی هایپر صنعت هستم. بفرمایید، در خدمت شما هستم.';

interface Turn {
  role: 'user' | 'model';
  text: string;
}

export const AiForzaCallExperience: React.FC<AiForzaCallExperienceProps> = ({ onClose }) => {
  // Visual scene state matching exact template
  const [paused, setPaused] = useState(false);
  const [revision, setRevision] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [clean, setClean] = useState(false);
  const [quality, setQuality] = useState('auto');
  const [stats, setStats] = useState<{ fps: number | null; tier: string; renderMs: number }>({
    fps: null,
    tier: 'AUTO',
    renderMs: 0,
  });
  const [fullscreenError, setFullscreenError] = useState('');
  const [reducedMotion, setReducedMotion] = useState(false);
  const shell = useRef<HTMLDivElement | null>(null);

  // Conversational AI state
  const [isCallActive, setIsCallActive] = useState(true);
  const [status, setStatusState] = useState<ForzaStatus>('idle');
  const [turn, setTurn] = useState<'user' | 'ai' | 'idle'>('ai');
  const [aiText, setAiText] = useState(GREETING_TEXT);
  const [displayedAi, setDisplayedAi] = useState('');
  const [userText, setUserText] = useState('');
  const [seconds, setSeconds] = useState(0);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);

  const statusRef = useRef<ForzaStatus>('idle');
  const historyRef = useRef<Turn[]>([]);
  const isAiSpeakingRef = useRef<boolean>(false);
  const recognitionRef = useRef<any>(null);
  const silenceTimerRef = useRef<number | null>(null);
  const activeTranscriptRef = useRef<string>('');

  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const setStatus = useCallback((s: ForzaStatus) => {
    statusRef.current = s;
    setStatusState(s);
  }, []);

  // Reduced motion preference
  useEffect(() => {
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(motion.matches);
    update();
    motion.addEventListener('change', update);
    return () => motion.removeEventListener('change', update);
  }, []);

  // Keyboard shortcuts matching provided template
  useEffect(() => {
    function keyboard(e: KeyboardEvent) {
      if (/INPUT|SELECT|TEXTAREA|BUTTON/.test((e.target as HTMLElement).tagName)) return;
      if (e.code === 'Space') {
        e.preventDefault();
        setPaused(p => !p);
      }
      if (e.key.toLowerCase() === 'h') setClean(c => !c);
      if (e.key.toLowerCase() === 'r') {
        setRevision(r => r + 1);
        setPaused(false);
      }
    }
    document.addEventListener('keydown', keyboard);
    return () => document.removeEventListener('keydown', keyboard);
  }, []);

  // Fullscreen toggle
  async function fullscreen() {
    try {
      setFullscreenError('');
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (shell.current?.requestFullscreen) {
        await shell.current.requestFullscreen();
      } else {
        setFullscreenError('Fullscreen is not supported in this browser.');
      }
    } catch {
      setFullscreenError('Fullscreen is unavailable here.');
    }
  }

  // Typewriter for AI subtitle
  useEffect(() => {
    if (!aiText) {
      setDisplayedAi('');
      return;
    }
    let i = 0;
    setDisplayedAi('');
    const id = window.setInterval(() => {
      i += 3;
      setDisplayedAi(aiText.slice(0, i));
      if (i >= aiText.length) window.clearInterval(id);
    }, 20);
    return () => window.clearInterval(id);
  }, [aiText]);

  // Call duration timer
  useEffect(() => {
    if (!isCallActive) return;
    const id = window.setInterval(() => setSeconds(s => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [isCallActive]);

  const ensureCtx = useCallback(() => {
    if (!ctxRef.current) {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      ctxRef.current = new AC();
    }
    if (ctxRef.current.state === 'suspended') void ctxRef.current.resume();
    return ctxRef.current;
  }, []);

  const stopAudio = useCallback(() => {
    isAiSpeakingRef.current = false;
    try {
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    } catch { /* noop */ }
    const a = audioElRef.current;
    if (a) {
      a.pause();
      a.removeAttribute('src');
      a.load();
    }
  }, []);

  const playDataUrl = useCallback(
    (url: string) =>
      new Promise<void>((resolve, reject) => {
        const a = audioElRef.current;
        if (!a) {
          reject(new Error('no-audio'));
          return;
        }
        ensureCtx();
        const onEnded = () => {
          a.removeEventListener('ended', onEnded);
          a.removeEventListener('error', onError);
          resolve();
        };
        const onError = () => {
          a.removeEventListener('ended', onEnded);
          a.removeEventListener('error', onError);
          reject(new Error('play-error'));
        };
        a.addEventListener('ended', onEnded);
        a.addEventListener('error', onError);
        a.src = url;
        void a.play().catch(reject);
      }),
    [ensureCtx],
  );

  const speakBrowserFallback = useCallback(
    (text: string) =>
      new Promise<void>(resolve => {
        try {
          if (!('speechSynthesis' in window)) return resolve();
          const u = new SpeechSynthesisUtterance(text);
          u.lang = 'fa-IR';
          u.rate = 0.95;
          isAiSpeakingRef.current = true;
          u.onend = () => {
            isAiSpeakingRef.current = false;
            resolve();
          };
          u.onerror = () => {
            isAiSpeakingRef.current = false;
            resolve();
          };
          window.speechSynthesis.cancel();
          window.speechSynthesis.speak(u);
        } catch {
          isAiSpeakingRef.current = false;
          resolve();
        }
      }),
    [],
  );

  const speakText = useCallback(
    async (text: string) => {
      isAiSpeakingRef.current = true;
      setStatus('speaking');
      setTurn('ai');
      try {
        const res = await fetch('/api/ai/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });
        const data = await res.json().catch(() => null);
        if (data?.audioBase64) {
          await playDataUrl(data.audioBase64);
          return;
        }
        throw new Error('no-audio');
      } catch {
        await speakBrowserFallback(text);
      } finally {
        isAiSpeakingRef.current = false;
      }
    },
    [playDataUrl, setStatus, speakBrowserFallback],
  );

  // Turn management: send query to AI
  const handleUserFinishedSpeaking = useCallback(
    async (textToSend: string) => {
      const q = textToSend.trim();
      if (!q || isAiSpeakingRef.current || statusRef.current === 'thinking') return;

      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch { /* noop */ }
      }

      setStatus('thinking');
      setTurn('ai');
      activeTranscriptRef.current = '';

      try {
        const res = await fetch('/api/ai/forza-live', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: q,
            history: historyRef.current.slice(-8),
          }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success) throw new Error(data?.error || 'server-error');

        const reply = data.text || '';
        if (reply) {
          historyRef.current.push({ role: 'user', text: q });
          historyRef.current.push({ role: 'model', text: reply });
          setAiText(reply);

          if (data.audioBase64) {
            setStatus('speaking');
            setTurn('ai');
            try {
              await playDataUrl(data.audioBase64);
            } catch {
              await speakText(reply);
            }
          } else {
            await speakText(reply);
          }
        }
      } catch {
        setErrorNotice('خطا در پاسخ هوش مصنوعی فورزا؛ لطفاً مجدداً بفرمایید.');
      } finally {
        setStatus('listening');
        setTurn('user');
        if (recognitionRef.current) {
          try {
            recognitionRef.current.start();
          } catch { /* already listening */ }
        }
      }
    },
    [playDataUrl, setStatus, speakText],
  );

  const initSpeechRecognition = useCallback(() => {
    const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRec) return null;

    try {
      const rec = new SpeechRec();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = 'fa-IR';

      rec.onresult = (event: any) => {
        if (isAiSpeakingRef.current || statusRef.current === 'thinking') return;

        let interim = '';
        let final = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const trans = event.results[i][0]?.transcript || '';
          if (event.results[i].isFinal) {
            final += trans;
          } else {
            interim += trans;
          }
        }

        const currentSpeech = (final || interim || '').trim();
        if (currentSpeech) {
          activeTranscriptRef.current = currentSpeech;
          setUserText(currentSpeech);
          setStatus('listening');
          setTurn('user');

          if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = window.setTimeout(() => {
            if (activeTranscriptRef.current && !isAiSpeakingRef.current) {
              const textToSend = activeTranscriptRef.current;
              activeTranscriptRef.current = '';
              void handleUserFinishedSpeaking(textToSend);
            }
          }, 1250);
        }
      };

      rec.onerror = () => {};
      rec.onend = () => {
        if (statusRef.current !== 'thinking' && !isAiSpeakingRef.current && isCallActive) {
          try {
            rec.start();
          } catch { /* already running */ }
        }
      };

      return rec;
    } catch {
      return null;
    }
  }, [handleUserFinishedSpeaking, isCallActive, setStatus]);

  // Initial startup: greeting & mic setup
  useEffect(() => {
    let mounted = true;
    async function start() {
      ensureCtx();
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (mounted) streamRef.current = stream;
      } catch {
        /* mic not granted or unavailable */
      }
      if (!mounted) return;
      recognitionRef.current = initSpeechRecognition();
      historyRef.current.push({ role: 'model', text: GREETING_TEXT });
      await speakText(GREETING_TEXT);
      if (mounted) {
        setStatus('listening');
        setTurn('user');
        if (recognitionRef.current) {
          try {
            recognitionRef.current.start();
          } catch { /* noop */ }
        }
      }
    }
    void start();

    return () => {
      mounted = false;
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch { /* noop */ }
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
      stopAudio();
    };
  }, [ensureCtx, initSpeechRecognition, setStatus, speakText, stopAudio]);

  const endCall = useCallback(() => {
    stopAudio();
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch { /* noop */ }
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
    }
    setIsCallActive(false);
    if (onClose) onClose();
  }, [onClose, stopAudio]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60).toString().padStart(2, '0');
    const r = (s % 60).toString().padStart(2, '0');
    return `${m}:${r}`;
  };

  return (
    <main
      ref={shell}
      className={`experience ${clean ? 'clean' : ''}`}
      onDoubleClick={e => {
        if ((e.target as HTMLElement).tagName === 'CANVAS') setClean(c => !c);
      }}
    >
      {/* 3D Particle Humanoid Canvas */}
      <ParticleHumanoid
        paused={paused}
        speed={speed}
        restartKey={revision}
        quality={quality}
        onStats={setStats}
      />

      {/* Hidden audio element */}
      <audio ref={audioElRef} className="hidden" playsInline />

      {/* Stage Header */}
      {!clean && (
        <header className="stage-header">
          <div className="brand-lockup">
            <div className="corner-mark" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </div>
            <div>
              <strong>FORZA</strong>
              <span>HUMAN SYSTEMS / 001</span>
            </div>
          </div>

          <div className="telemetry">
            <span className={paused || reducedMotion ? 'idle' : ''} />
            <b>{reducedMotion ? 'STILL' : paused ? 'PAUSED' : status === 'speaking' ? 'SPEAKING' : status === 'thinking' ? 'THINKING' : 'LIVE'}</b>
            <small>
              {stats.tier} · {paused || reducedMotion ? 'HOLD' : stats.fps ? `${stats.fps} FPS` : 'INITIALIZING'} · {formatTime(seconds)}
            </small>
          </div>
        </header>
      )}

      {/* Left side label */}
      {!clean && (
        <div className="scene-label" aria-hidden="true">
          <span>PROCEDURAL IDENTITY</span>
          <strong>Built from light.</strong>
        </div>
      )}

      {/* Turn indicator & Live Subtitles Overlay */}
      <div
        dir="rtl"
        className="absolute top-[38%] sm:top-auto sm:bottom-28 inset-x-4 sm:right-8 sm:left-auto sm:max-w-md z-20 flex flex-col gap-2.5 pointer-events-none"
      >
        {/* Turn Status Pill */}
        <div className="self-start inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#101012]/90 border border-white/10 backdrop-blur-md shadow-lg text-xs pointer-events-auto">
          <span
            className={`w-2 h-2 rounded-full ${
              turn === 'user'
                ? 'bg-emerald-400 shadow-[0_0_8px_#34d399] animate-pulse'
                : status === 'thinking'
                ? 'bg-amber-400 shadow-[0_0_8px_#fbbf24] animate-pulse'
                : 'bg-[#e06518] shadow-[0_0_8px_#e06518]'
            }`}
          />
          <span className="font-medium text-white/90">
            {turn === 'user'
              ? 'نوبت شماست (مستقیم صحبت کنید)'
              : status === 'thinking'
              ? 'AI FORZA در حال پردازش...'
              : 'AI FORZA در حال صحبت...'}
          </span>
        </div>

        {/* User Subtitle */}
        {userText && (
          <div className="text-sm bg-black/85 border border-cyan-500/30 text-cyan-100 px-3.5 py-2 rounded-xl backdrop-blur-md shadow-md animate-fadeIn pointer-events-auto">
            <span className="text-emerald-400 font-bold ml-1.5">شما:</span>
            <span>{userText}</span>
          </div>
        )}

        {/* AI Subtitle */}
        {displayedAi && (
          <div className="text-sm bg-[#18181c]/90 border border-[#e06518]/30 text-white/95 px-4 py-3 rounded-xl backdrop-blur-md shadow-xl max-h-48 overflow-y-auto pointer-events-auto leading-relaxed">
            <div className="text-[11px] font-bold text-[#e06518] mb-0.5 tracking-wider">AI FORZA :</div>
            <p>{displayedAi}</p>
          </div>
        )}
      </div>

      {/* Stage Footer */}
      {!clean && (
        <div className="stage-footer">
          <span>AMBER CORE / V.02</span>
          <span>SPACE: PAUSE &nbsp; R: REPLAY &nbsp; H: HIDE</span>
        </div>
      )}

      {/* Restore controls button when hidden */}
      {clean && (
        <button
          className="restore-controls"
          onClick={() => setClean(false)}
          aria-label="Show controls"
        >
          <Eye size={18} />
        </button>
      )}

      {/* Bottom Controls toolbar */}
      {!clean && (
        <div className="controls">
          <div className="control-buttons" role="group" aria-label="Scene controls">
            <Button
              variant="ghost"
              size="icon"
              aria-label={paused ? 'Play animation' : 'Pause animation'}
              title={paused ? 'Play' : 'Pause'}
              onClick={() => setPaused(p => !p)}
            >
              {paused ? <Play /> : <Pause />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Replay formation"
              title="Replay formation"
              onClick={() => {
                setRevision(r => r + 1);
                setPaused(false);
              }}
            >
              <RotateCcw />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Animation speed ${speed}x. Click to change.`}
              title="Animation speed"
              onClick={() => setSpeed(s => (s === 1 ? 0.5 : s === 0.5 ? 1.5 : 1))}
            >
              {speed}×
            </Button>

            <span className="control-divider" aria-hidden="true" />

            <label className="quality-control">
              <SlidersHorizontal size={16} />
              <span className="sr-only">Render quality</span>
              <select
                value={quality}
                onChange={e => setQuality(e.target.value)}
                aria-label="Render quality"
              >
                <option value="auto">Auto</option>
                <option value="high">Ultra</option>
                <option value="balanced">Balanced</option>
                <option value="low">Eco</option>
              </select>
            </label>

            <Button
              variant="ghost"
              size="icon"
              aria-label="Hide controls. Double-click to restore."
              title="Hide controls (double-click to restore)"
              onClick={() => setClean(true)}
            >
              <EyeOff />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Toggle fullscreen"
              title="Fullscreen"
              onClick={fullscreen}
            >
              <Maximize />
            </Button>

            <span className="control-divider" aria-hidden="true" />

            {/* Exit / End Call Button */}
            <Button
              variant="ghost"
              size="sm"
              className="text-red-400 hover:text-red-300 hover:bg-red-950/60 font-medium text-xs px-2.5"
              title="End Call"
              onClick={endCall}
            >
              <PhoneOff size={14} className="ml-1" />
              خروج
            </Button>
          </div>
        </div>
      )}

      {/* Fullscreen error notice */}
      {fullscreenError && (
        <div className="notice" role="status">
          {fullscreenError}
          <button onClick={() => setFullscreenError('')} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      {/* Error Notice */}
      {errorNotice && (
        <div className="notice" role="status">
          {errorNotice}
          <button onClick={() => setErrorNotice(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
    </main>
  );
};

export default AiForzaCallExperience;
