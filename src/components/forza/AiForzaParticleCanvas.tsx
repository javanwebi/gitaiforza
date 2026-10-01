import React from 'react';
import { ParticleHumanoid } from './ParticleHumanoid';

export type ForzaStatus = 'idle' | 'listening' | 'thinking' | 'speaking';

interface AiForzaParticleCanvasProps {
  statusRef?: React.MutableRefObject<ForzaStatus> | { current: ForzaStatus };
  audioLevelRef?: React.MutableRefObject<number> | { current: number };
  className?: string;
  showControls?: boolean;
}

export const AiForzaParticleCanvas: React.FC<AiForzaParticleCanvasProps> = ({
  statusRef,
  audioLevelRef,
  className = '',
}) => {
  return (
    <div className={`relative w-full h-full min-h-screen bg-[#101012] overflow-hidden ${className}`}>
      <ParticleHumanoid
        statusRef={statusRef as any}
        audioLevelRef={audioLevelRef as any}
        className="w-full h-full"
      />
    </div>
  );
};

export default AiForzaParticleCanvas;
