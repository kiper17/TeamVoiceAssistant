import { useState, useEffect, useRef } from 'react';
import { 
  collection, addDoc, doc, updateDoc, 
  getDocs, deleteDoc, onSnapshot, 
  increment, writeBatch, query, where
} from 'firebase/firestore';
import { db } from '../firebase';
import './VoiceAssistant.css';

type Team = {
  id: string;
  name: string;
  members: number[];
  points: number;
  expanded: boolean;
  ownerId: string;
};

type User = {
  id: string;
  name: string;
};

const VoiceAssistant = () => {
  const [isListening, setIsListening] = useState(false);
  const [text, setText] = useState('');
  const [isSupported, setIsSupported] = useState(true);
  const [showTeamCreator, setShowTeamCreator] = useState(false);
  const [teamCount, setTeamCount] = useState(2);
  const [peopleCount, setPeopleCount] = useState(4);
  const [teams, setTeams] = useState<Team[]>([]);
  const [micPermissionGranted, setMicPermissionGranted] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [username, setUsername] = useState('');
  const [showAuthForm, setShowAuthForm] = useState(true);

  const buttonRef = useRef<HTMLButtonElement>(null);

  // Проверка поддержки голосового API
  useEffect(() => {
    if (!('SpeechRecognition' in window) && !('webkitSpeechRecognition' in window)) {
      setIsSupported(false);
    }
  }, []);

  // Запрос разрешения на микрофон
  useEffect(() => {
    const requestMicPermission = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop());
        setMicPermissionGranted(true);
      } catch (error) {
        console.error('Microphone access denied:', error);
      }
    };
    requestMicPermission();
  }, []);

  // Авторизация пользователя
  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (username.trim()) {
      const user: User = {
        id: generateUserId(),
        name: username.trim()
      };
      setCurrentUser(user);
      setShowAuthForm(false);
      localStorage.setItem('currentUser', JSON.stringify(user));
    }
  };

  // Выход из системы
  const handleLogout = () => {
    setCurrentUser(null);
    setUsername('');
    setShowAuthForm(true);
    localStorage.removeItem('currentUser');
  };

  // Генерация ID пользователя
  const generateUserId = () => {
    return 'user-' + Math.random().toString(36).substr(2, 9);
  };

  // Загрузка сохраненного пользователя
  useEffect(() => {
    const savedUser = localStorage.getItem('currentUser');
    if (savedUser) {
      setCurrentUser(JSON.parse(savedUser));
      setShowAuthForm(false);
    }
  }, []);

  // Подписка на команды пользователя
  useEffect(() => {
    if (!currentUser) return;

    const teamsQuery = query(
      collection(db, 'teams'),
      where('ownerId', '==', currentUser.id)
    );

    const unsubscribe = onSnapshot(teamsQuery, (snapshot) => {
      const loadedTeams = snapshot.docs.map(doc => ({
        id: doc.id,
        name: doc.data().name,
        members: doc.data().members,
        points: doc.data().points,
        expanded: false,
        ownerId: doc.data().ownerId
      }));
      setTeams(loadedTeams);
    });

    return () => unsubscribe();
  }, [currentUser]);

  // Голосовой помощник
  useEffect(() => {
    if (!micPermissionGranted || !currentUser) return;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.lang = 'ru-RU';
    recognition.interimResults = false;
    recognition.continuous = true;

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      setText(transcript);
      handleVoiceCommand(transcript);
    };

    recognition.onerror = (event) => {
      console.error('Ошибка распознавания:', event.error);
    };

    if (isListening) {
      recognition.start();
    }

    return () => {
      recognition.stop();
    };
  }, [isListening, micPermissionGranted, currentUser]);

  // Обновление очков команды
  const updateTeamPoints = async (teamId: string, delta: number) => {
    if (!currentUser) return;

    try {
      await updateDoc(doc(db, 'teams', teamId), {
        points: increment(delta)
      });
    } catch (error) {
      console.error("Ошибка обновления очков:", error);
      alert("Не удалось изменить очки");
    }
  };

  // Обработка голосовых команд
  const handleVoiceCommand = async (command: string) => {
    if (!currentUser) return;

    const normalizedCommand = command.toLowerCase().trim();
    const match = normalizedCommand.match(
      /команда\s+(\d+)\s+(плюс|минус|\+|\-)\s*(\d+)/i
    );
    
    if (match && teams.length > 0) {
      const teamNumber = parseInt(match[1]);
      const operator = match[2];
      let points = parseInt(match[3]);
      
      if (operator === 'минус' || operator === '-') {
        points = -points;
      }
      
      const teamToUpdate = teams.find(team => team.name === `Команда ${teamNumber}`);
      
      if (teamToUpdate) {
        await updateTeamPoints(teamToUpdate.id, points);
        setText(`Выполнено: ${command}`);
      } else {
        setText(`Ошибка: команды ${teamNumber} не существует`);
      }
    } else {
      setText(`Не распознано: ${command}`);
    }
  };

  // Создание команд
  const createTeams = async () => {
    if (!currentUser) {
      alert("Требуется авторизация");
      return;
    }

    if (teamCount === 0 || peopleCount === 0) {
      alert("Количество команд и участников должно быть больше 0");
      return;
    }
    
    const people = Array.from({length: peopleCount}, (_, i) => i + 1);
    const shuffled = [...people].sort(() => 0.5 - Math.random());
    
    const batch = writeBatch(db);
    
    // Удаляем старые команды пользователя
    const teamsQuery = query(
      collection(db, 'teams'),
      where('ownerId', '==', currentUser.id)
    );
    const snapshot = await getDocs(teamsQuery);
    snapshot.forEach(doc => {
      batch.delete(doc.ref);
    });
    
    // Создаем новые команды
    for (let i = 0; i < teamCount; i++) {
      const members = shuffled.slice(
        Math.floor(i * shuffled.length / teamCount),
        Math.floor((i + 1) * shuffled.length / teamCount)
      );
      
      batch.set(doc(collection(db, 'teams')), {
        name: `Команда ${i + 1}`,
        members,
        points: 0,
        ownerId: currentUser.id
      });
    }
    
    try {
      await batch.commit();
      setShowTeamCreator(false);
    } catch (error) {
      console.error("Ошибка создания команд:", error);
      alert("Ошибка при создании команд");
    }
  };

  // Вспомогательные функции
  const toggleTeamExpansion = (teamId: string) => {
    setTeams(teams.map(team => 
      team.id === teamId ? {...team, expanded: !team.expanded} : team
    ));
  };

  const handleTeamCountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value === '' || /^\d+$/.test(value)) {
      setTeamCount(value === '' ? 0 : parseInt(value));
    }
  };

  const handlePeopleCountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value === '' || /^\d+$/.test(value)) {
      setPeopleCount(value === '' ? 0 : parseInt(value));
    }
  };

  const handleMicClick = () => {
    if (!micPermissionGranted) {
      alert("Пожалуйста, разрешите доступ к микрофону");
      return;
    }
    setIsListening(!isListening);
  };

  if (!isSupported) {
    return (
      <div className="browser-warning">
        Ваш браузер не поддерживает голосовое управление.
        Попробуйте Google Chrome или Microsoft Edge.
      </div>
    );
  }

  if (showAuthForm) {
    return (
      <div className="auth-container">
        <form onSubmit={handleLogin} className="auth-form">
          <h2>Вход в систему</h2>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Введите ваше имя"
            required
          />
          <button type="submit">Войти</button>
        </form>
      </div>
    );
  }

  return (
    <div className="voice-assistant-container">
      <div className="user-header">
        <span>Пользователь: {currentUser?.name}</span>
        <button onClick={handleLogout} className="logout-button">Выйти</button>
      </div>

      <button 
        className="team-creator-button"
        onClick={() => setShowTeamCreator(true)}
        aria-label="Создать команды"
      >
        <svg className="team-icon" viewBox="0 0 24 24">
          <path fill="currentColor" d="M16 17V19H2V17S2 13 9 13 16 17 16 17M12.5 7.5A3.5 3.5 0 1 0 9 11A3.5 3.5 0 0 0 12.5 7.5M15.94 13A5.32 5.32 0 0 1 18 17V19H22V17S22 13.37 15.94 13M15 4A3.39 3.39 0 0 0 13.07 4.59A5 5 0 0 1 13.07 10.41A3.39 3.39 0 0 0 15 11A3.5 3.5 0 0 0 15 4Z" />
        </svg>
      </button>

      <div className="main-interface">
        {teams.length > 0 ? (
          <div className="teams-ranking">
            <h2>Рейтинг команд</h2>
            <div className="teams-list">
              {[...teams].sort((a, b) => b.points - a.points).map((team) => (
                <div key={team.id} className="team-item">
                  <div 
                    className="team-header"
                    onClick={() => toggleTeamExpansion(team.id)}
                  >
                    <span className="team-name">{team.name}</span>
                    <span className="team-points">{team.points} очков</span>
                    <span className="team-toggle">
                      {team.expanded ? '▲' : '▼'}
                    </span>
                  </div>
                  {team.expanded && (
                    <div className="team-members">
                      <h4>Участники:</h4>
                      <ul>
                        {team.members.map((member) => (
                          <li key={member}>{member}</li>
                        ))}
                      </ul>
                      <div className="team-controls">
                        <button 
                          className="points-button minus"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            updateTeamPoints(team.id, -1);
                          }}
                        >
                          -1
                        </button>
                        <button 
                          className="points-button plus"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            updateTeamPoints(team.id, 1);
                          }}
                        >
                          +1
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="no-teams-message">
            Создайте свои первые команды
          </div>
        )}

        <div className="center-block">
          <div className="mic-container">
            <button 
              ref={buttonRef}
              onClick={handleMicClick}
              className={`mic-button ${isListening ? 'active' : ''}`}
              aria-label={isListening ? 'Остановить запись' : 'Начать запись'}
              disabled={!micPermissionGranted}
            >
              <svg className="mic-icon" viewBox="0 0 24 24">
                <path fill="currentColor" d="M12,2A3,3 0 0,1 15,5V11A3,3 0 0,1 12,14A3,3 0 0,1 9,11V5A3,3 0 0,1 12,2M19,11C19,14.53 16.39,17.44 13,17.93V21H11V17.93C7.61,17.44 5,14.53 5,11H7A5,5 0 0,0 12,16A5,5 0 0,0 17,11H19Z" />
              </svg>
            </button>
            <div className="mic-status">
              {!micPermissionGranted 
                ? "Разрешите доступ к микрофону" 
                : isListening 
                  ? "Идет запись..." 
                  : "Нажмите для записи"}
            </div>
          </div>

          <div className="output">
            <h3>Распознанный текст:</h3>
            <div className="text-content">
              {text || <span className="placeholder">Здесь будет отображаться распознанная речь</span>}
            </div>
          </div>
        </div>
      </div>

      {showTeamCreator && (
        <div className="modal-overlay">
          <div className="team-creator-modal">
            <h3>Создать команды</h3>
            
            <div className="input-group">
              <label>Количество команд:</label>
              <div className="number-input">
                <button 
                  onClick={() => setTeamCount(Math.max(1, teamCount - 1))}
                  className="number-control minus"
                >
                  −
                </button>
                <input 
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={teamCount}
                  onChange={handleTeamCountChange}
                  className="number-input-field"
                />
                <button 
                  onClick={() => setTeamCount(teamCount + 1)}
                  className="number-control plus"
                >
                  +
                </button>
              </div>
            </div>
            
            <div className="input-group">
              <label>Количество участников:</label>
              <div className="number-input">
                <button 
                  onClick={() => setPeopleCount(Math.max(1, peopleCount - 1))}
                  className="number-control minus"
                >
                  −
                </button>
                <input 
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={peopleCount}
                  onChange={handlePeopleCountChange}
                  className="number-input-field"
                />
                <button 
                  onClick={() => setPeopleCount(peopleCount + 1)}
                  className="number-control plus"
                >
                  +
                </button>
              </div>
            </div>
            
            <div className="modal-buttons">
              <button onClick={createTeams} className="create-button">Создать</button>
              <button 
                onClick={() => setShowTeamCreator(false)} 
                className="cancel-button"
              >
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VoiceAssistant;