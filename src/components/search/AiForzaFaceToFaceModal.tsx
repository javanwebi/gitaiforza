import React, { useEffect } from 'react';
import { AiForzaExperience } from '../forza/AiForzaExperience';

export interface AiForzaFaceToFaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSwitchToWorkspace?: () => void;
  onSyncMessage?: (userText: string, aiText: string) => void;
  initialQuery?: string;
  initialImage?: string;
}

export const AiForzaFaceToFaceModal: React.FC<AiForzaFaceToFaceModalProps> = ({
  isOpen,
  onClose,
}) => {
  useEffect(() => {
    if (!isOpen) return;

    // Prevent background scrolling when full-screen cinematic modal is open
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Support ESC key to exit
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 w-screen h-screen min-h-[100dvh] overflow-hidden bg-[#0A0D12]"
      role="dialog"
      aria-modal="true"
      aria-label="AI FORZA Face-to-Face Cinematic Experience"
    >
      <AiForzaExperience onClose={onClose} showCloseButton={true} />
    </div>
  );
};
