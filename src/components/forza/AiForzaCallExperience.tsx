import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AiForzaParticleCanvas, ForzaStatus } from './AiForzaParticleCanvas';

interface AiForzaCallExperienceProps {
  onClose?: () => void;
}

type Phase = 'entry' | 'active';

const GREETING_TEXT = 'من هوش مصنوعی فورزا، مشاور فنی هایپر صنعت هستم. بفرمایید، در خدمت شما هستم.';

interface Turn {
  role: 'user' | 'model';
  text: string;
}

export const AiForzaCallExperience: React.FC<AiForzaCallExperienceProps> = ({ onClose }) => {
  const [phase, setPhase] = useState<Phase>('entry');
  const [status, setStatusState] = useState<ForzaStatus>('idle');
  const [aiText, setAiText] = useState('');
  const [displayedAi, setDisplayedAi] = useState('');
  const [userText, setUserText] = useState('');
  const [turn, setTurn] = useState<'user' | 'ai' | 'idle'>('idle');
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const statusRef = useRef<ForzaStatus>('idle');
  const audioLevelRef = useRef<number>(0);
  const historyRef = useRef<Turn[]>([]);
  const isAiSpeakingRef = useRef<boolean>(false);
  const recognitionRef = useRef<any>(null);
  const silenceTimerRef = useRef<number | null>(null);
  const activeTranscriptRef = useRef<string>('');

  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const elAnalyserRef = useRef<AnalyserNode | null>(null);
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const micSrcRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const levelTimerRef = useRef<number | null>(null);
  const levelDataRef = useRef<Uint8Array | null>(null);

  const setStatus = useCallback((s: ForzaStatus) => {
    statusRef.current = s;
    setStatusState(s);
  }, []);

  /* ---------------- Typewriter for AI Subtitle ---------------- */
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
    }, 22);
    return () => window.clearInterval(id);
  }, [aiText]);

  /* ---------------- Call duration timer ---------------- */
  useEffect(() => {
    if (phase !== 'active') return;
    const id = window.setInterval(() => setSeconds(s => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [phase]);

  /* ---------------- Voice Level Pump (Drives Particle Humanoid) ---------------- */
  useEffect(() => {
    const tick = () => {
      const st = statusRef.current;
      let target = 0;
      const analyser = st === 'speaking' ? elAnalyserRef.current : st === 'listening' ? micAnalyserRef.current : null;
      if (analyser) {
        if (!levelDataRef.current || levelDataRef.current.length !== analyser.fftSize) {
          levelDataRef.current = new Uint8Array(analyser.fftSize);
        }
        const buf = levelDataRef.current;
        analyser.getByteTimeDomainData(buf as any);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.length);
        target = Math.min(1, rms * 3.4) * (st === 'listening' ? 0.6 : 1);
      }
      const cur = audioLevelRef.current;
      audioLevelRef.current = cur * 0.6 + target * 0.4;
    };
    levelTimerRef.current = window.setInterval(tick, 50);
    return () => {
      if (levelTimerRef.current) window.clearInterval(levelTimerRef.current);
    };
  }, []);

  /* ---------------- Audio Graph & Playback ---------------- */
  const ensureCtx = useCallback(() => {
    if (!ctxRef.current) {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      ctxRef.current = new AC();
    }
    if (ctxRef.current.state === 'suspended') void ctxRef.current.resume();
    return ctxRef.current;
  }, []);

  const ensureElementAnalyser = useCallback(() => {
    const ctx = ensureCtx();
    const audio = audioElRef.current;
    if (!audio || elAnalyserRef.current) return;
    try {
      const src = ctx.createMediaElementSource(audio);
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      an.connect(ctx.destination);
      elAnalyserRef.current = an;
    } catch {
      /* media element source already connected */
    }
  }, [ensureCtx]);

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
        ensureElementAnalyser();
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
    [ensureCtx, ensureElementAnalyser],
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

  /* ---------------- Continuous Hands-Free Dialogue Engine ---------------- */
  const handleUserFinishedSpeaking = useCallback(
    async (textToSend: string) => {
      const q = textToSend.trim();
      if (!q || isAiSpeakingRef.current || statusRef.current === 'thinking') return;

      // Pause speech recognition while AI processes & answers
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
        setError('خطا در برقراری ارتباط با مشاور؛ مجدداً بفرمایید.');
      } finally {
        // Automatically transfer turn back to user and resume listening
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

          // Reset silence & sentence pause detection timer (1.25s silence triggers AI turn)
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

      rec.onerror = (e: any) => {
        if (e.error !== 'no-speech') {
          // Keep alive
        }
      };

      rec.onend = () => {
        // Auto-restart if call is active and AI is not speaking
        if (statusRef.current !== 'thinking' && !isAiSpeakingRef.current) {
          try {
            rec.start();
          } catch { /* already running */ }
        }
      };

      return rec;
    } catch {
      return null;
    }
  }, [handleUserFinishedSpeaking, setStatus]);

  /* ---------------- Start Call Flow ---------------- */
  const startCall = useCallback(async () => {
    ensureCtx();
    setPhase('active');
    setSeconds(0);
    setError(null);
    setUserText('');
    historyRef.current = [];

    // 1. Get mic stream for VAD & Particle articulation
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      try {
        const ctx = ensureCtx();
        const src = ctx.createMediaStreamSource(stream);
        const an = ctx.createAnalyser();
        an.fftSize = 512;
        src.connect(an);
        micSrcRef.current = src;
        micAnalyserRef.current = an;
      } catch { /* optional */ }
    } catch {
      setError('دسترسی به میکروفون برای مکالمه صوتی مورد نیاز است.');
    }

    // 2. Initialize Speech Recognition
    recognitionRef.current = initSpeechRecognition();

    // 3. AI Welcome Greeting
    setAiText(GREETING_TEXT);
    historyRef.current.push({ role: 'model', text: GREETING_TEXT });
    await speakText(GREETING_TEXT);

    // 4. Immediately give turn to user
    setStatus('listening');
    setTurn('user');
    if (recognitionRef.current) {
      try {
        recognitionRef.current.start();
      } catch { /* noop */ }
    }
  }, [ensureCtx, initSpeechRecognition, setStatus, speakText]);

  const endCall = useCallback(() => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch { /* noop */ }
      recognitionRef.current = null;
    }
    if (micSrcRef.current) {
      try {
        micSrcRef.current.disconnect();
      } catch { /* noop */ }
      micSrcRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    stopAudio();
    setStatus('idle');
    setTurn('idle');
    setAiText('');
    setUserText('');
    setSeconds(0);
    historyRef.current = [];
    setPhase('entry');
    if (onClose) onClose();
  }, [onClose, setStatus, stopAudio]);

  useEffect(() => {
    return () => {
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
  }, [stopAudio]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60).toString().padStart(2, '0');
    const r = (s % 60).toString().padStart(2, '0');
    return `${m}:${r}`.replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
  };

  return (
    <div dir="rtl" className="relative w-full h-full min-h-[100dvh] bg-[#101012] text-white overflow-hidden select-none font-sans">
      {/* Pure 2D Canvas Particle Humanoid with glowing FORZA chest logo (Zero Icons) */}
      <div className="absolute inset-0">
        <AiForzaParticleCanvas statusRef={statusRef} audioLevelRef={audioLevelRef} showControls={false} />
      </div>

      {/* Hidden audio player */}
      <audio ref={audioElRef} className="hidden" playsInline />

      {/* Top Header: Clean textual turn-taking status and minimal text exit button (NO ICONS) */}
      <header className="absolute top-0 inset-x-0 z-30 flex items-center justify-between px-5 sm:px-8 pt-4">
        {/* Turn Status Pill (Text and glow only, zero icons) */}
        {phase === 'active' && (
          <div className="flex items-center gap-2.5 px-4 py-2 rounded-full bg-black/60 backdrop-blur-md border border-white/10 text-[13px] shadow-lg">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                turn === 'user'
                  ? 'bg-emerald-400 shadow-[0_0_10px_#34d399] animate-pulse'
                  : status === 'thinking'
                  ? 'bg-amber-400 shadow-[0_0_10px_#fbbf24] animate-pulse'
                  : 'bg-orange-500 shadow-[0_0_10px_#e06518]'
              }`}
            />
            <span className="font-semibold text-white/95">
              {turn === 'user'
                ? 'نوبت شماست — بفرمایید صحبت کنید...'
                : status === 'thinking'
                ? 'AI FORZA در حال پردازش...'
                : 'AI FORZA در حال صحبت...'}
            </span>
            <span className="text-white/40 text-[11px] font-mono mr-1.5">{formatTime(seconds)}</span>
          </div>
        )}

        <div className="flex-1" />

        {/* Minimal Text-Only Exit Button (No icons) */}
        <button
          type="button"
          onClick={endCall}
          className="px-4 py-2 rounded-full bg-black/40 hover:bg-red-950/80 border border-white/15 hover:border-red-500/50 text-xs font-medium text-white/70 hover:text-white backdrop-blur-md transition-all cursor-pointer"
        >
          پایان تماس
        </button>
      </header>

      {/* ---------------- Live Real-Time Subtitles (User speech + AI response) ---------------- */}
      {phase === 'active' && (
        <div className="absolute top-[48%] bottom-6 inset-x-4 z-20 flex flex-col justify-end items-center gap-3 pointer-events-none md:top-auto md:bottom-8 md:left-10 md:right-auto md:w-[460px] md:max-w-[460px] md:items-start">
          {/* User Live Speech Transcription Subtitle */}
          {userText && (
            <div className="max-w-xl md:max-w-none text-[14px] text-cyan-100 bg-black/80 backdrop-blur-md px-4 py-2.5 rounded-2xl border border-cyan-400/30 shadow-lg animate-fadeIn">
              <span className="text-emerald-400 font-bold ml-1.5">شما:</span>
              <span>{userText}</span>
            </div>
          )}

          {/* AI Live Response Subtitle */}
          {displayedAi && (
            <div className="max-w-xl md:max-w-none w-full px-5 py-3.5 rounded-2xl bg-black/85 backdrop-blur-md border border-orange-500/35 shadow-[0_0_30px_rgba(224,101,24,0.18)] max-h-[38vh] overflow-y-auto pointer-events-auto">
              <div className="text-[12px] text-orange-400 font-bold mb-1">AI FORZA :</div>
              <p className={`text-[14px] sm:text-[15px] leading-8 text-white/95 ${status === 'speaking' ? 'ai-caret' : ''}`}>
                {displayedAi}
              </p>
            </div>
          )}
        </div>
      )}

      {/* ---------------- Entry Screen (Clean, Zero Icons) ---------------- */}
      {phase === 'entry' && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/65 px-6 backdrop-blur-[2px]">
          <div className="flex flex-col items-center text-center max-w-md animate-fadeIn">
            <h1 className="text-4xl sm:text-5xl font-black tracking-widest text-white drop-shadow-[0_0_24px_#e06518]" dir="ltr">
              AI FORZA
            </h1>
            <p className="mt-3 text-[15px] font-semibold text-orange-200">مشاور هوشمند هایپر صنعت اطلس</p>
            <p className="mt-2.5 text-[13px] leading-7 text-white/70">
              مکالمه صوتی خودکار و زنده؛ پس از ورود مستقیم صحبت کنید، هوش مصنوعی با تشخیص مکث شما پاسخ دقیق و تخصصی ارائه می‌دهد.
            </p>
            <button
              type="button"
              onClick={() => void startCall()}
              className="mt-8 px-10 py-3.5 rounded-full bg-[#e06518] hover:bg-[#f37424] text-white font-bold text-[16px] shadow-[0_0_25px_#e06518] hover:shadow-[0_0_35px_#e06518] transition-all cursor-pointer active:scale-95"
            >
              شروع مکالمه هوشمند
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AiForzaCallExperience;
