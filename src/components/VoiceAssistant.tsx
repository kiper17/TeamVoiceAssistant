import { useState, useEffect, useRef, useCallback } from 'react';
import { 
  collection, doc, updateDoc, 
  getDocs, deleteDoc, onSnapshot, 
  increment, writeBatch, query, where,
  setDoc
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
  // Состояния
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
  const [isProcessing, setIsProcessing] = useState(false);

  const buttonRef = useRef<HTMLButtonElement>(null);
  const recognitionRef = useRef<any>(null);

  // Генерация ID пользователя
  const generateUserId = useCallback(() => {
    return 'user-' + Math.random().toString(36).substr(2, 9);
  }, []);

  // Проверка поддержки голосового API
  useEffect(() => {
    if (!('SpeechRecognition' in window) && !('webkitSpeechRecognition' in window)) {
      setIsSupported(false);
      return;
    }
    
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognitionRef.current = new SpeechRecognition();
    recognitionRef.current.lang = 'ru-RU';
    recognitionRef.current.interimResults = false;
    recognitionRef.current.continuous = true;

    recognitionRef.current.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setText(transcript);
      handleVoiceCommand(transcript);
    };

    recognitionRef.current.onerror = (event: any) => {
      console.error('Ошибка распознавания:', event.error);
      if (event.error === 'not-allowed') {
        setMicPermissionGranted(false);
      }
    };

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);

  // Запрос разрешения на микрофон
  const requestMicPermission = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
      setMicPermissionGranted(true);
    } catch (error) {
      console.error('Доступ к микрофону отклонен:', error);
      setMicPermissionGranted(false);
    }
  }, []);

  useEffect(() => {
    requestMicPermission();
  }, [requestMicPermission]);

  // Авторизация пользователя
  const handleLogin = useCallback((e: React.FormEvent) => {
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
  }, [username, generateUserId]);

  // Выход из системы
  const handleLogout = useCallback(() => {
    setCurrentUser(null);
    setTeams([]);
    setShowAuthForm(true);
    localStorage.removeItem('currentUser');
    if (isListening) {
      setIsListening(false);
      recognitionRef.current?.stop();
    }
  }, [isListening]);

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

  // Управление голосовым помощником
  useEffect(() => {
    if (!micPermissionGranted || !currentUser) return;

    if (isListening) {
      recognitionRef.current?.start();
    } else {
      recognitionRef.current?.stop();
    }

    return () => {
      recognitionRef.current?.stop();
    };
  }, [isListening, micPermissionGranted, currentUser]);

  // Обновление очков команды
  const updateTeamPoints = useCallback(async (teamId: string, delta: number) => {
    if (!currentUser || isProcessing) return;

    setIsProcessing(true);
    try {
      await updateDoc(doc(db, 'teams', teamId), {
        points: increment(delta)
      });
    } catch (error) {
      console.error("Ошибка обновления очков:", error);
      alert("Не удалось изменить очки");
    } finally {
      setIsProcessing(false);
    }
  }, [currentUser, isProcessing]);

  // Обработка голосовых команд
  const handleVoiceCommand = useCallback(async (command: string) => {
    if (!currentUser || teams.length === 0) return;

    const normalizedCommand = command.toLowerCase().trim();
    const match = normalizedCommand.match(
      /(команда|команде)\s+(\d+)\s+(плюс|минус|\+|\-)\s*(\d+)/i
    );
    
    if (match) {
      const teamNumber = parseInt(match[2]);
      const operator = match[3];
      let points = parseInt(match[4]);
      
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
  }, [currentUser, teams, updateTeamPoints]);

  // Создание команд
  const createTeams = useCallback(async () => {
    if (!currentUser || isProcessing) {
      alert("Требуется авторизация");
      return;
    }

    if (teamCount < 1 || peopleCount < 1) {
      alert("Количество команд и участников должно быть больше 0");
      return;
    }

    setIsProcessing(true);
    try {
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

      // Генерируем участников и распределяем по командам
      const people = Array.from({ length: peopleCount }, (_, i) => i + 1);
      const shuffled = [...people].sort(() => 0.5 - Math.random());

      // Создаем новые команды
      for (let i = 0; i < teamCount; i++) {
        const members = shuffled.slice(
          Math.floor(i * shuffled.length / teamCount),
          Math.floor((i + 1) * shuffled.length / teamCount)
        );

        const newTeamRef = doc(collection(db, 'teams'));
        batch.set(newTeamRef, {
          name: `Команда ${i + 1}`,
          members,
          points: 0,
          ownerId: currentUser.id
        });
      }

      await batch.commit();
      setShowTeamCreator(false);
    } catch (error) {
      console.error("Ошибка создания команд:", error);
      alert("Ошибка при создании команд");
    } finally {
      setIsProcessing(false);
    }
  }, [currentUser, teamCount, peopleCount, isProcessing]);

  // Переключение отображения участников команды
  const toggleTeamExpansion = useCallback((teamId: string) => {
    setTeams(prevTeams => 
      prevTeams.map(team => 
        team.id === teamId ? {...team, expanded: !team.expanded} : team
      )
    );
  }, []);

  // Обработчик клика по микрофону
  const handleMicClick = useCallback(() => {
    if (!micPermissionGranted) {
      alert("Пожалуйста, разрешите доступ к микрофону в настройках браузера");
      return;
    }
    setIsListening(prev => !prev);
  }, [micPermissionGranted]);

  // Изменение количества команд
  const handleTeamCountChange = useCallback((value: number) => {
    setTeamCount(Math.max(1, Math.min(10, value)));
  }, []);

  // Изменение количества участников
  const handlePeopleCountChange = useCallback((value: number) => {
    setPeopleCount(Math.max(1, Math.min(100, value)));
  }, []);

  if (!isSupported) {
    return (
      <div className="browser-warning">
        <h2>Не поддерживается</h2>
        <p>Ваш браузер не поддерживает голосовое управление.</p>
        <p>Попробуйте Google Chrome или Microsoft Edge.</p>
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
            autoFocus
          />
          <button type="submit" disabled={!username.trim()}>
            {isProcessing ? 'Загрузка...' : 'Войти'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="voice-assistant-container">
      <header className="app-header">
        <div className="user-info">
          <span>Пользователь: {currentUser?.name}</span>
          <button onClick={handleLogout} className="logout-button">
            Выйти
          </button>
        </div>
      </header>

      <main className="app-main">
        <div className="teams-section">
          <div className="section-header">
            <h2>Управление командами</h2>
            <button 
              className="create-teams-button"
              onClick={() => setShowTeamCreator(true)}
              disabled={isProcessing}
            >
              <svg viewBox="0 0 24 24" className="icon">
                <path fill="currentColor" d="M19,13H13V19H11V13H5V11H11V5H13V11H19V13Z" />
              </svg>
              Создать команды
            </button>
          </div>

          {teams.length > 0 ? (
            <div className="teams-list">
              {[...teams]
                .sort((a, b) => b.points - a.points)
                .map((team) => (
                  <div key={team.id} className={`team-card ${team.expanded ? 'expanded' : ''}`}>
                    <div 
                      className="team-header"
                      onClick={() => toggleTeamExpansion(team.id)}
                    >
                      <div className="team-info">
                        <span className="team-name">{team.name}</span>
                        <span className="team-points">{team.points} очков</span>
                      </div>
                      <div className="team-actions">
                        <button
                          className="points-button minus"
                          onClick={(e) => {
                            e.stopPropagation();
                            updateTeamPoints(team.id, -1);
                          }}
                          disabled={isProcessing}
                        >
                          -1
                        </button>
                        <button
                          className="points-button plus"
                          onClick={(e) => {
                            e.stopPropagation();
                            updateTeamPoints(team.id, 1);
                          }}
                          disabled={isProcessing}
                        >
                          +1
                        </button>
                        <span className="expand-icon">
                          {team.expanded ? '▲' : '▼'}
                        </span>
                      </div>
                    </div>
                    
                    {team.expanded && (
                      <div className="team-details">
                        <div className="team-members">
                          <h4>Участники:</h4>
                          <div className="members-list">
                            {team.members.map((member) => (
                              <span key={member} className="member-badge">
                                {member}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
            </div>
          ) : (
            <div className="empty-state">
              <svg viewBox="0 0 24 24" className="empty-icon">
                <path fill="currentColor" d="M12,2A10,10 0 0,1 22,12A10,10 0 0,1 12,22A10,10 0 0,1 2,12A10,10 0 0,1 12,2M12,4A8,8 0 0,0 4,12A8,8 0 0,0 12,20A8,8 0 0,0 20,12A8,8 0 0,0 12,4M12,10.5A1.5,1.5 0 0,1 13.5,12A1.5,1.5 0 0,1 12,13.5A1.5,1.5 0 0,1 10.5,12A1.5,1.5 0 0,1 12,10.5M7.5,10.5A1.5,1.5 0 0,1 9,12A1.5,1.5 0 0,1 7.5,13.5A1.5,1.5 0 0,1 6,12A1.5,1.5 0 0,1 7.5,10.5M16.5,10.5A1.5,1.5 0 0,1 18,12A1.5,1.5 0 0,1 16.5,13.5A1.5,1.5 0 0,1 15,12A1.5,1.5 0 0,1 16.5,10.5Z" />
              </svg>
              <p>Нет созданных команд</p>
              <button 
                onClick={() => setShowTeamCreator(true)}
                className="primary-button"
              >
                Создать команды
              </button>
            </div>
          )}
        </div>

        <div className="voice-control-section">
          <div className="voice-control-card">
            <h3>Голосовое управление</h3>
            
            <div className="mic-container">
              <button 
                ref={buttonRef}
                onClick={handleMicClick}
                className={`mic-button ${isListening ? 'listening' : ''}`}
                disabled={!micPermissionGranted || isProcessing}
              >
                <svg viewBox="0 0 24 24" className="mic-icon">
                  <path fill="currentColor" d="M12,2A3,3 0 0,1 15,5V11A3,3 0 0,1 12,14A3,3 0 0,1 9,11V5A3,3 0 0,1 12,2M19,11C19,14.53 16.39,17.44 13,17.93V21H11V17.93C7.61,17.44 5,14.53 5,11H7A5,5 0 0,0 12,16A5,5 0 0,0 17,11H19Z" />
                </svg>
              </button>
              
              <div className="mic-status">
                {!micPermissionGranted ? (
                  <span className="warning">Разрешите доступ к микрофону</span>
                ) : isListening ? (
                  <span className="active">Слушаю...</span>
                ) : (
                  <span>Нажмите для голосовой команды</span>
                )}
              </div>
            </div>

            <div className="voice-commands-info">
              <h4>Примеры команд:</h4>
              <ul>
                <li>"Команда 1 плюс 5"</li>
                <li>"Команде 2 минус 3"</li>
              </ul>
            </div>

            <div className="voice-output">
              <h4>Распознанная команда:</h4>
              <div className="output-text">
                {text || <span className="placeholder">Здесь будет отображаться распознанная команда</span>}
              </div>
            </div>
          </div>
        </div>
      </main>

      {showTeamCreator && (
        <div className="modal-overlay">
          <div className="team-creator-modal">
            <div className="modal-header">
              <h3>Создание команд</h3>
              <button 
                onClick={() => setShowTeamCreator(false)}
                className="close-button"
              >
                &times;
              </button>
            </div>
            
            <div className="modal-body">
              <div className="form-group">
                <label>Количество команд:</label>
                <div className="number-input-group">
                  <button 
                    onClick={() => handleTeamCountChange(teamCount - 1)}
                    disabled={teamCount <= 1}
                  >
                    -
                  </button>
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={teamCount}
                    onChange={(e) => handleTeamCountChange(parseInt(e.target.value) || 1)}
                  />
                  <button 
                    onClick={() => handleTeamCountChange(teamCount + 1)}
                    disabled={teamCount >= 10}
                  >
                    +
                  </button>
                </div>
              </div>
              
              <div className="form-group">
                <label>Количество участников:</label>
                <div className="number-input-group">
                  <button 
                    onClick={() => handlePeopleCountChange(peopleCount - 1)}
                    disabled={peopleCount <= 1}
                  >
                    -
                  </button>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={peopleCount}
                    onChange={(e) => handlePeopleCountChange(parseInt(e.target.value) || 1)}
                  />
                  <button 
                    onClick={() => handlePeopleCountChange(peopleCount + 1)}
                    disabled={peopleCount >= 100}
                  >
                    +
                  </button>
                </div>
              </div>
            </div>
            
            <div className="modal-footer">
              <button 
                onClick={createTeams}
                className="primary-button"
                disabled={isProcessing}
              >
                {isProcessing ? 'Создание...' : 'Создать команды'}
              </button>
              <button 
                onClick={() => setShowTeamCreator(false)}
                className="secondary-button"
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