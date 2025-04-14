import React, { useState } from 'react';
import './CreateTeamsModal.css';

interface CreateTeamsModalProps {
  onClose: () => void;
  onCreateTeams: (numTeams: number, playersPerTeam: number) => void;
}

const CreateTeamsModal: React.FC<CreateTeamsModalProps> = ({ onClose, onCreateTeams }) => {
  const [numTeams, setNumTeams] = useState(2);
  const [playersPerTeam, setPlayersPerTeam] = useState(4);

  const handleTeamsChange = (delta: number) => {
    const newValue = numTeams + delta;
    if (newValue >= 2 && newValue <= 10) {
      setNumTeams(newValue);
    }
  };

  const handlePlayersChange = (delta: number) => {
    const newValue = playersPerTeam + delta;
    if (newValue >= 1 && newValue <= 10) {
      setPlayersPerTeam(newValue);
    }
  };

  const handleCreate = () => {
    onCreateTeams(numTeams, playersPerTeam);
    onClose();
  };

  return (
    <div className="modal-overlay">
      <div className="modal">
        <button className="close-button" onClick={onClose}>×</button>
        <h2>Создание команд</h2>
        
        <div className="input-group">
          <label>Количество команд:</label>
          <div className="number-input">
            <button onClick={() => handleTeamsChange(-1)}>-</button>
            <span>{numTeams}</span>
            <button onClick={() => handleTeamsChange(1)}>+</button>
          </div>
        </div>

        <div className="input-group">
          <label>Количество участников:</label>
          <div className="number-input">
            <button onClick={() => handlePlayersChange(-1)}>-</button>
            <span>{playersPerTeam}</span>
            <button onClick={() => handlePlayersChange(1)}>+</button>
          </div>
        </div>

        <div className="modal-buttons">
          <button className="create-teams-button" onClick={handleCreate}>
            Создать команды
          </button>
          <button className="cancel-button" onClick={onClose}>
            Отмена
          </button>
        </div>
      </div>
    </div>
  );
};

export default CreateTeamsModal; 