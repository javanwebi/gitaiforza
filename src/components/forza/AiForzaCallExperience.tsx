import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  X,
  Mic,
  Square,
  PhoneOff,
  Phone,
  Volume2,
  VolumeX,
  SendHorizontal,
  Loader2,
  Keyboard,
} from 'lucide-react';
import { AiForzaParticleCanvas, ForzaStatus } from './AiForzaParticleCanvas';

interface AiForzaCallExperienceProps {
  onClose?: () => void;
}

type Phase = 'entry' | 'active';

const GREETING_TEXT = 'من AI Forza مشاور صنعت پیش هستم. بفرمایید چطور می‌توانم کمکتان کنم؟';

const STATUS_EN: Record<ForzaStatus, string> = {
  idle: 'IDLE',
  listening: 'LISTENING',
  thinking: 'THINKING',
  speaking: 'SPEAKING',
};

const STATUS_FA: Record<ForzaStatus, string> = {
  idle: 'آماده',
  listening: 'در حال شنیدن…',
  thinking: 'در حال فکر…',
  speaking: 'در حال صحبت…',
};

const faDigits = (v: string | number) =>
  String(v).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

const formatTime = (s: number) => {
  const m = Math.floor(s / 60).toString().padStart(2, '0');
  const r = (s % 60).toString().padStart(2, '0');
  return faDigits(`${m}:${r}`);
};

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
  const [input, setInput] = useState('');
  const [textMode, setTextMode] = useState(false);
  const [muted, setMuted] = useState(false);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const statusRef = useRef<ForzaStatus>('idle');
  const audioLevelRef = useRef<number>(0);
  const mutedRef = useRef(false);
  const browserSpeakingRef = useRef(false);
  const discardRecordingRef = useRef(false);
  const historyRef = useRef<Turn[]>([]);

  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const elAnalyserRef = useRef<AnalyserNode | null>(null);
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const micSrcRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const levelTimerRef = useRef<number | null>(null);
  const levelDataRef = useRef<Uint8Array | null>(null);

  const setStatus = useCallback((s: ForzaStatus) => {
    statusRef.current = s;
    setStatusState(s);
  }, []);

  /* ---------------- typewriter for AI subtitle ---------------- */
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

  /* ---------------- call timer ---------------- */
  useEffect(() => {
    if (phase !== 'active') return;
    const id = window.setInterval(() => setSeconds(s => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [phase]);

  /* ---------------- voice level pump (drives particles) ---------------- */
  useEffect(() => {
    const tick = () => {
      const st = statusRef.current;
      let target = 0;
      if (browserSpeakingRef.current) {
        target = 0.3 + 0.25 * Math.abs(Math.sin(Date.now() / 180));
      } else {
        const analyser = st === 'speaking' ? elAnalyserRef.current : st === 'listening' ? micAnalyserRef.current : null;
        if (analyser) {
          if (!levelDataRef.current || levelDataRef.current.length !== analyser.fftSize) {
            levelDataRef.current = new Uint8Array(analyser.fftSize);
          }
          const buf = levelDataRef.current;
          analyser.getByteTimeDomainData(buf as Uint8Array<ArrayBuffer>);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) {
            const v = (buf[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / buf.length);
          target = Math.min(1, rms * 3.2) * (st === 'listening' ? 0.55 : 1);
        }
      }
      const cur = audioLevelRef.current;
      audioLevelRef.current = cur * 0.6 + target * 0.4;
    };
    levelTimerRef.current = window.setInterval(tick, 60);
    return () => {
      if (levelTimerRef.current) window.clearInterval(levelTimerRef.current);
    };
  }, []);

  /* ---------------- audio graph ---------------- */
  const ensureCtx = useCallback(() => {
    if (!ctxRef.current) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
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
      /* source already attached — ignore */
    }
  }, [ensureCtx]);

  const stopAudio = useCallback(() => {
    browserSpeakingRef.current = false;
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
        a.muted = mutedRef.current;
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
          browserSpeakingRef.current = true;
          u.onend = () => {
            browserSpeakingRef.current = false;
            resolve();
          };
          u.onerror = () => {
            browserSpeakingRef.current = false;
            resolve();
          };
          window.speechSynthesis.cancel();
          window.speechSynthesis.speak(u);
        } catch {
          browserSpeakingRef.current = false;
          resolve();
        }
      }),
    [],
  );

  const speakText = useCallback(
    async (text: string) => {
      setStatus('speaking');
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
      }
    },
    [playDataUrl, setStatus, speakBrowserFallback],
  );

  /* ---------------- conversation turn ---------------- */
  const sendTurn = useCallback(
    async (opts: { query?: string; audioBase64?: string; audioMimeType?: string }) => {
      setBusy(true);
      setError(null);
      setStatus('thinking');
      try {
        const res = await fetch('/api/ai/forza-live', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: opts.query || '',
            audioBase64: opts.audioBase64 || undefined,
            audioMimeType: opts.audioMimeType || undefined,
            history: historyRef.current.slice(-6),
          }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success) throw new Error(data?.error || 'server-error');

        const transcript: string = data.userTranscript || opts.query || '';
        const reply: string = data.text || '';
        if (transcript) {
          setUserText(transcript);
          historyRef.current.push({ role: 'user', text: transcript });
        }
        if (reply) {
          historyRef.current.push({ role: 'model', text: reply });
          setAiText(reply);
          if (data.audioBase64) {
            setStatus('speaking');
            try {
              await playDataUrl(data.audioBase64);
            } catch {
              await speakText(reply);
              return;
            }
          } else {
            await speakText(reply);
            return;
          }
        }
        setStatus('idle');
      } catch {
        setError('خطا در ارتباط با AI Forza — دوباره تلاش کنید');
        setStatus('idle');
      } finally {
        setBusy(false);
      }
    },
    [playDataUrl, setStatus, speakText],
  );

  /* ---------------- greeting on first entry ---------------- */
  const startCall = useCallback(async () => {
    ensureCtx();
    setPhase('active');
    setSeconds(0);
    setError(null);
    setUserText('');
    historyRef.current = [];
    setAiText(GREETING_TEXT);
    historyRef.current.push({ role: 'model', text: GREETING_TEXT });
    await speakText(GREETING_TEXT);
    setStatus('idle');
  }, [ensureCtx, setStatus, speakText]);

  /* ---------------- mic recording ---------------- */
  const cleanupStream = useCallback(() => {
    if (micSrcRef.current) {
      try {
        micSrcRef.current.disconnect();
      } catch { /* noop */ }
      micSrcRef.current = null;
    }
    micAnalyserRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
  }, []);

  const startRecording = useCallback(async () => {
    try {
      setError(null);
      const ctx = ensureCtx();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      try {
        const src = ctx.createMediaStreamSource(stream);
        const an = ctx.createAnalyser();
        an.fftSize = 512;
        src.connect(an);
        micSrcRef.current = src;
        micAnalyserRef.current = an;
      } catch { /* analyser optional */ }

      const mimes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
      const mime = mimes.find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunksRef.current = [];
      discardRecordingRef.current = false;
      rec.ondataavailable = e => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const shouldDiscard = discardRecordingRef.current;
        const chunks = chunksRef.current;
        const usedMime = rec.mimeType || 'audio/webm';
        setRecording(false);
        cleanupStream();
        if (shouldDiscard || chunks.length === 0) {
          if (!shouldDiscard) setStatus('idle');
          return;
        }
        const blob = new Blob(chunks, { type: usedMime });
        const reader = new FileReader();
        reader.onloadend = () => {
          const dataUrl = String(reader.result || '');
          if (!dataUrl) {
            setStatus('idle');
            return;
          }
          void sendTurn({ audioBase64: dataUrl, audioMimeType: usedMime });
        };
        reader.readAsDataURL(blob);
      };
      recorderRef.current = rec;
      rec.start();
      setRecording(true);
      setStatus('listening');
    } catch {
      setError('دسترسی به میکروفون ممکن نیست — اجازه میکروفون را فعال کنید یا از حالت متنی استفاده کنید');
      setStatus('idle');
    }
  }, [cleanupStream, ensureCtx, sendTurn, setStatus]);

  const stopRecording = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') rec.stop();
    else {
      setRecording(false);
      cleanupStream();
      setStatus('idle');
    }
  }, [cleanupStream, setStatus]);

  const toggleMic = useCallback(() => {
    if (phase !== 'active') return;
    if (recording) {
      stopRecording();
      return;
    }
    if (status === 'thinking' || busy) return;
    if (status === 'speaking') stopAudio();
    void startRecording();
  }, [busy, phase, recording, startRecording, status, stopAudio, stopRecording]);

  const submitText = useCallback(() => {
    const q = input.trim();
    if (!q || busy || phase !== 'active') return;
    if (recording) {
      discardRecordingRef.current = true;
      stopRecording();
    }
    if (status === 'speaking') stopAudio();
    setInput('');
    void sendTurn({ query: q });
  }, [busy, input, phase, recording, sendTurn, status, stopAudio, stopRecording]);

  const endCall = useCallback(() => {
    discardRecordingRef.current = true;
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') {
      try {
        rec.stop();
      } catch { /* noop */ }
    }
    recorderRef.current = null;
    setRecording(false);
    cleanupStream();
    stopAudio();
    setStatus('idle');
    setAiText('');
    setUserText('');
    setInput('');
    setSeconds(0);
    historyRef.current = [];
    setPhase('entry');
  }, [cleanupStream, setStatus, stopAudio]);

  const toggleMute = useCallback(() => {
    setMuted(m => {
      const next = !m;
      mutedRef.current = next;
      if (audioElRef.current) audioElRef.current.muted = next;
      return next;
    });
  }, []);

  /* cleanup on unmount */
  useEffect(
    () => () => {
      try {
        discardRecordingRef.current = true;
        const rec = recorderRef.current;
        if (rec && rec.state !== 'inactive') rec.stop();
      } catch { /* noop */ }
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
      const a = audioElRef.current;
      if (a) a.pause();
      try {
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      } catch { /* noop */ }
    },
    [],
  );

  /* ESC → close */
  useEffect(() => {
    if (!onClose) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const dotColor =
    status === 'speaking'
      ? 'bg-orange-500 shadow-[0_0_8px_#f97316]'
      : status === 'listening'
        ? 'bg-cyan-300 shadow-[0_0_8px_#22d3ee] animate-pulse'
        : status === 'thinking'
          ? 'bg-amber-400 shadow-[0_0_8px_#fbbf24] animate-pulse'
          : 'bg-cyan-500/70 shadow-[0_0_6px_#06b6d4]';

  return (
    <div dir="rtl" className="relative w-full h-full min-h-[100dvh] bg-[#04060a] text-white overflow-hidden select-none">
      {/* 3D particle entity — full-bleed, no images */}
      <div className="absolute inset-0">
        <AiForzaParticleCanvas statusRef={statusRef} audioLevelRef={audioLevelRef} />
      </div>

      {/* readability gradients */}
      <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/70 to-transparent pointer-events-none z-10" />
      <div className="absolute inset-x-0 bottom-0 h-72 bg-gradient-to-t from-black/80 via-black/30 to-transparent pointer-events-none z-10" />

      {/* hidden audio element */}
      <audio ref={audioElRef} className="hidden" playsInline />

      {/* ---------------- top bar ---------------- */}
      <header className="absolute top-0 inset-x-0 z-20 flex items-center justify-between px-5 sm:px-8 pt-5">
        <div className="flex items-center gap-3">
          <span className={`w-2 h-2 rounded-full ${dotColor}`} />
          <div>
            <div className="text-sm sm:text-base font-extrabold tracking-[0.18em] text-white" dir="ltr">
              AI FORZA
            </div>
            <div className="text-[11px] text-cyan-200/60 tracking-wide">مشاور صنعت پیش</div>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <div
            className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/40 backdrop-blur-md border border-cyan-400/15 font-mono text-[11px] tracking-[0.22em] text-cyan-300/90"
            dir="ltr"
          >
            STATUS: {STATUS_EN[status]}
          </div>
          {phase === 'active' && (
            <div className="px-3 py-1.5 rounded-full bg-black/40 backdrop-blur-md border border-white/10 text-[12px] tabular-nums text-white/75 font-mono" dir="ltr">
              {formatTime(seconds)}
            </div>
          )}
          <button
            type="button"
            onClick={toggleMute}
            aria-label={muted ? 'روشن کردن صدا' : 'بی‌صدا کردن'}
            className="w-9 h-9 rounded-xl bg-black/40 hover:bg-black/70 border border-white/15 text-white/70 hover:text-white flex items-center justify-center backdrop-blur-md transition-all cursor-pointer"
          >
            {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="بستن"
              className="w-9 h-9 rounded-xl bg-black/40 hover:bg-black/70 border border-white/15 hover:border-orange-500/50 text-white/70 hover:text-white flex items-center justify-center backdrop-blur-md transition-all cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </header>

      {/* mobile status */}
      <div className="sm:hidden absolute top-[74px] inset-x-0 z-20 flex justify-center pointer-events-none">
        <div className="px-3 py-1 rounded-full bg-black/40 backdrop-blur-md border border-cyan-400/15 font-mono text-[10px] tracking-[0.22em] text-cyan-300/90" dir="ltr">
          STATUS: {STATUS_EN[status]}
        </div>
      </div>

      {/* ---------------- error toast ---------------- */}
      {error && (
        <div className="absolute top-24 inset-x-0 z-30 flex justify-center px-6 ai-fade-up">
          <div className="flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-red-950/70 border border-red-500/30 backdrop-blur-md text-[13px] text-red-100">
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)} aria-label="بستن خطا" className="text-red-300/70 hover:text-white cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* ---------------- subtitles ---------------- */}
      {phase === 'active' && (
        <div className="absolute bottom-44 sm:bottom-40 inset-x-0 z-20 flex flex-col items-center gap-2.5 px-6 pointer-events-none">
          {userText && (
            <div className="max-w-xl text-[13px] text-cyan-100/70 ai-fade-up">
              <span className="text-cyan-300/50">شما: </span>
              {userText}
            </div>
          )}
          {displayedAi && (
            <div className="max-w-xl w-full sm:w-auto px-5 py-3 rounded-2xl bg-black/50 backdrop-blur-md border border-cyan-400/20 shadow-[0_0_30px_rgba(34,211,238,0.08)]">
              <p className={`text-[14px] sm:text-[15px] leading-8 text-white/95 ${status === 'speaking' || status === 'thinking' ? 'ai-caret' : ''}`}>
                {displayedAi}
              </p>
              <div className="mt-1 text-[11px] text-cyan-200/50">{STATUS_FA[status]}</div>
            </div>
          )}
        </div>
      )}

      {/* ---------------- bottom controls ---------------- */}
      {phase === 'active' && (
        <div className="absolute bottom-6 sm:bottom-8 inset-x-0 z-30 flex flex-col items-center gap-4 px-6">
          {/* waveform */}
          <div className="h-8 flex items-center gap-[3px]" dir="ltr" aria-hidden="true">
            {status !== 'idle' ? (
              Array.from({ length: 26 }).map((_, i) => (
                <span
                  key={i}
                  className={`ai-wave-bar ${
                    status === 'speaking'
                      ? 'bg-gradient-to-t from-orange-600 to-amber-300'
                      : status === 'listening'
                        ? 'bg-gradient-to-t from-cyan-600 to-cyan-200'
                        : 'bg-white/50'
                  }`}
                  style={{
                    height: `${10 + ((i * 7) % 18)}px`,
                    animationDelay: `${(i % 9) * 0.09}s`,
                    animationDuration: status === 'thinking' ? '0.6s' : '0.9s',
                  }}
                />
              ))
            ) : (
              <span className="text-[12px] text-white/35">برای صحبت، دکمه میکروفون را لمس کنید</span>
            )}
          </div>

          {/* text input */}
          {textMode && (
            <div className="w-full max-w-xl flex items-center gap-2 px-2 py-2 rounded-2xl bg-black/55 backdrop-blur-md border border-white/12 ai-fade-up">
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') submitText();
                }}
                placeholder="پیام خود را بنویسید…"
                className="flex-1 bg-transparent outline-none text-[14px] text-white placeholder:text-white/30 px-3 py-1.5"
                autoFocus
              />
              <button
                type="button"
                onClick={submitText}
                disabled={busy || !input.trim()}
                aria-label="ارسال"
                className="w-10 h-10 shrink-0 rounded-xl bg-cyan-500/90 hover:bg-cyan-400 disabled:opacity-40 text-black flex items-center justify-center transition-all cursor-pointer"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <SendHorizontal className="w-4 h-4 -scale-x-100" />}
              </button>
            </div>
          )}

          {/* buttons */}
          <div className="flex items-center gap-4 sm:gap-5">
            <button
              type="button"
              onClick={() => setTextMode(v => !v)}
              aria-label="گفتگوی متنی"
              title="گفتگوی متنی"
              className={`w-[52px] h-[52px] rounded-full border backdrop-blur-md flex items-center justify-center transition-all cursor-pointer active:scale-95 ${
                textMode
                  ? 'bg-cyan-500/25 border-cyan-400/60 text-cyan-200'
                  : 'bg-black/45 border-white/15 text-white/70 hover:text-white hover:border-cyan-400/40'
              }`}
            >
              <Keyboard className="w-5 h-5" />
            </button>

            <button
              type="button"
              onClick={toggleMic}
              disabled={status === 'thinking' || busy}
              aria-label={recording ? 'پایان ضبط' : 'شروع صحبت'}
              title={recording ? 'پایان ضبط' : 'شروع صحبت'}
              className={`w-[76px] h-[76px] rounded-full flex items-center justify-center transition-all cursor-pointer active:scale-95 disabled:opacity-60 ${
                recording
                  ? 'bg-red-500/90 text-white ai-mic-listening'
                  : 'bg-gradient-to-b from-cyan-300 to-cyan-500 text-black shadow-[0_0_36px_rgba(34,211,238,0.45)] hover:shadow-[0_0_50px_rgba(34,211,238,0.6)]'
              }`}
            >
              {status === 'thinking' || busy ? (
                <Loader2 className="w-7 h-7 animate-spin" />
              ) : recording ? (
                <Square className="w-6 h-6 fill-current" />
              ) : (
                <Mic className="w-7 h-7" />
              )}
            </button>

            <button
              type="button"
              onClick={endCall}
              aria-label="پایان تماس"
              title="پایان تماس"
              className="w-[52px] h-[52px] rounded-full bg-red-500/15 border border-red-500/40 text-red-300 hover:bg-red-500/30 hover:text-white backdrop-blur-md flex items-center justify-center transition-all cursor-pointer active:scale-95"
            >
              <PhoneOff className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      {/* ---------------- entry overlay ---------------- */}
      {phase === 'entry' && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/55 px-6" style={{ backdropFilter: 'blur(2px)' }}>
          <div className="flex flex-col items-center text-center max-w-md ai-fade-up">
            <div className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-cyan-500/10 border border-cyan-400/25 text-[12px] text-cyan-200">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-300 animate-pulse" />
              تماس صوتی زنده
            </div>
            <h1 className="mt-5 text-4xl sm:text-5xl font-black tracking-[0.14em] text-white drop-shadow-[0_0_24px_rgba(34,211,238,0.35)]" dir="ltr">
              AI FORZA
            </h1>
            <p className="mt-3 text-[15px] text-cyan-100/80">مشاور صنعت پیش — دستیار هوشمند صنعتی</p>
            <p className="mt-2 text-[13px] leading-7 text-white/50">
              برای شروع گفتگو دکمه زیر را لمس کنید؛ دستیار صوتی خودش را معرفی می‌کند و آماده شنیدن شماست.
            </p>
            <button
              type="button"
              onClick={() => void startCall()}
              className="mt-7 flex items-center gap-3 px-9 py-4 rounded-full bg-gradient-to-b from-cyan-300 to-cyan-500 text-black font-bold text-[16px] ai-entry-glow hover:brightness-110 transition-all cursor-pointer active:scale-95"
            >
              <Phone className="w-5 h-5" />
              شروع تماس
            </button>
            <p className="mt-4 text-[11px] text-white/35">برای گفتگو نیاز به دسترسی میکروفون است</p>
          </div>
        </div>
      )}
    </div>
  );
};
