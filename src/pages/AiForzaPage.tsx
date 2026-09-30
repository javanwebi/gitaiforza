import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AiForzaCinematicExperience } from '../components/search/AiForzaCinematicExperience';

export const AiForzaPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="w-screen h-screen min-h-[100svh] max-h-[100dvh] overflow-hidden bg-black p-0 m-0">
      <AiForzaCinematicExperience
        isStandalonePage={true}
        onClose={() => navigate('/')}
      />
    </div>
  );
};
