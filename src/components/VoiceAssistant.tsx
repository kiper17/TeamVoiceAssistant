import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  collection, 
  doc, 
  updateDoc, 
  getDocs, 
  writeBatch, 
  query, 
  where, 
  onSnapshot, 
  increment 
} from 'firebase/firestore';
import { db } from '../firebase';
import './VoiceAssistant.css';

enum AuthStatus {
  Idle = 'idle',
  Pending = 'pending',
  Success = 'success',
  Failed = 'failed'
}

const isPendingStatus = (status: AuthStatus): status is AuthStatus.Pending => {
  return status === AuthStatus.Pending;
};

type Team = {
  id: string;
  name: string;
  members: number[];
  points: number;
  expanded: boolean;
  ownerId: string;
};

type UserData = {
  name: string;
  username?: string;
  photoUrl?: string;
};

declare global {
  interface Window {
    Telegram?: {
      WebApp: {
        initData: string;
        initDataUnsafe: {
          user?: {
            id: number;
            first_name?: string;
            last_name?: string;
            username?: string;
            language_code?: string;
            photo_url?: string;
          };
        };
        showAlert: (message: string, callback?: () => void) => void;
        requestPermission: (permission: string, callback: (granted: boolean) => void) => void;
        expand: () => void;
        openTelegramLink: (url: string) => void;
        close: () => void;
        onEvent: (event: string, handler: () => void) => void;
        offEvent: (event: string, handler: () => void) => void;
        MainButton: {
          show: () => void;
          hide: () => void;
          setText: (text: string) => void;
          onClick: (callback: () => void) => void;
          offClick: (callback: () => void) => void;
        };
        BackButton: {
          show: () => void;
          hide: () => void;
          onClick: (callback: () => void) => void;
          offClick: (callback: () => void) => void;
        };
        enableClosingConfirmation: () => void;
        disableClosingConfirmation: () => void;
        colorScheme: 'light' | 'dark';
        isExpanded: boolean;
        platform: string;
      };
    };
  }
}

const AuthWarning: React.FC<{ 
  isTGWebView: boolean;
  onAuthSuccess: (user: { id: string; first_name?: string; last_name?: string; username?: string }) => void;
}> = ({ isTGWebView, onAuthSuccess }) => {
  const [authStatus, setAuthStatus] = useState<AuthStatus>(AuthStatus.Idle);

  const handleAuthClick = useCallback(() => {
    if (!isTGWebView || !window.Telegram?.WebApp) return;
    
    setAuthStatus(AuthStatus.Pending);
    const authToken = `webapp_${Date.now()}`;
    localStorage.setItem('tg_auth_token', authToken);
    
    window.Telegram.WebApp.openTelegramLink(
      `https://t.me/TeamsWebApp_bot?start=${authToken}`
    );
  }, [isTGWebView]);

  useEffect(() => {
    if (!isTGWebView || !isPendingStatus(authStatus)) return;

    const checkAuth = setInterval(() => {
      const tgUser = window.Telegram?.WebApp?.initDataUnsafe.user;
      if (tgUser?.id) {
        clearInterval(checkAuth);
        onAuthSuccess({
          id: tgUser.id.toString(),
          first_name: tgUser.first_name,
          last_name: tgUser.last_name,
          username: tgUser.username
        });
        setAuthStatus(AuthStatus.Success);
        localStorage.removeItem('tg_auth_token');
      }
    }, 1000);

    return () => clearInterval(checkAuth);
  }, [authStatus, isTGWebView, onAuthSuccess]);

  return (
    <div className="auth-container">
      <div className="auth-content">
        <h2>Требуется авторизация</h2>
        
        {isPendingStatus(authStatus) ? (
          <>
            <div className="auth-loader"></div>
            <p>Пожалуйста, завершите авторизацию в Telegram</p>
            <p>После авторизации нажмите кнопку ниже</p>
            <button 
              onClick={() => window.location.reload()} 
              className="auth-button"
            >
              Я авторизовался
            </button>
          </>
        ) : (
          <>
            <p>Для использования приложения необходимо войти через Telegram</p>
            <button 
              onClick={handleAuthClick} 
              className="auth-button tgph-button"
              disabled={isPendingStatus(authStatus)}
            >
              Войти через Telegram
            </button>
          </>
        )}

        {authStatus === AuthStatus.Failed && (
          <p className="auth-error">Ошибка авторизации. Пожалуйста, попробуйте снова.</p>
        )}
      </div>
    </div>
  );
};

const VoiceAssistant: React.FC = () => {
  const [isListening, setIsListening] = useState<boolean>(false);
  const [text, setText] = useState<string>('');
  const [isSupported, setIsSupported] = useState<boolean>(true);
  const [showTeamCreator, setShowTeamCreator] = useState<boolean>(false);
  const [teamCount, setTeamCount] = useState<number>(2);
  const [peopleCount, setPeopleCount] = useState<number>(4);
  const [teams, setTeams] = useState<Team[]>([]);
  const [isTGWebView, setIsTGWebView] = useState<boolean>(false);
  const [micPermissionGranted, setMicPermissionGranted] = useState<boolean>(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [userData, setUserData] = useState<UserData | null>(null);
  const [initialAuthCheck, setInitialAuthCheck] = useState<boolean>(false);

  const buttonRef = useRef<HTMLButtonElement>(null);

  const handleAuthSuccess = useCallback((tgUser: { 
    id: string; 
    first_name?: string; 
    last_name?: string; 
    username?: string 
  }) => {
    setUserId(tgUser.id);
    setUserData({
      name: [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' '),
      username: tgUser.username
    });
    
    if (window.Telegram?.WebApp) {
      window.Telegram.WebApp.disableClosingConfirmation();
    }
  }, []);

  const handleBackButtonClick = useCallback(() => {
    if (window.Telegram?.WebApp) {
      window.Telegram.WebApp.close();
    }
  }, []);

  const handleThemeChange = useCallback(() => {
    if (window.Telegram?.WebApp) {
      document.body.classList.toggle('telegram-dark', window.Telegram.WebApp.colorScheme === 'dark');
    }
  }, []);

  useEffect(() => {
    const userAgent = navigator.userAgent.toLowerCase();
    const isTelegram = userAgent.includes('telegram');
    setIsTGWebView(isTelegram);

    if (isTelegram && window.Telegram?.WebApp) {
      const tgWebApp = window.Telegram.WebApp;
      
      tgWebApp.expand();
      tgWebApp.enableClosingConfirmation();

      const tgUser = tgWebApp.initDataUnsafe.user;
      if (tgUser?.id) {
        handleAuthSuccess({
          id: tgUser.id.toString(),
          first_name: tgUser.first_name,
          last_name: tgUser.last_name,
          username: tgUser.username
        });
      }
      setInitialAuthCheck(true);

      tgWebApp.BackButton.show();
      tgWebApp.BackButton.onClick(handleBackButtonClick);

      tgWebApp.requestPermission('microphone', (granted) => {
        setMicPermissionGranted(granted);
        if (!granted) {
          tgWebApp.showAlert("Для работы голосового ассистента разрешите доступ к микрофону");
        }
      });

      tgWebApp.onEvent('themeChanged', handleThemeChange);
      handleThemeChange();

      return () => {
        tgWebApp.offEvent('themeChanged', handleThemeChange);
        tgWebApp.BackButton.offClick(handleBackButtonClick);
      };
    } else {
      setMicPermissionGranted(true);
      setInitialAuthCheck(true);
    }
  }, [handleAuthSuccess, handleBackButtonClick, handleThemeChange]);

  useEffect(() => {
    if (!userId) return;

    const teamsQuery = query(
      collection(db, 'teams'),
      where('ownerId', '==', userId)
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
  }, [userId]);

  useEffect(() => {
    if (!micPermissionGranted) return;

    const initVoiceRecognition = () => {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) {
        setIsSupported(false);
        return;
      }

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
        if (event.error === 'no-speech' && isListening) {
          recognition.start();
        }
      };

      if (isListening) {
        recognition.start();
      }

      return () => {
        recognition.stop();
      };
    };

    const cleanup = initVoiceRecognition();
    return cleanup;
  }, [isListening, micPermissionGranted]);

  const updateTeamPoints = useCallback(async (teamId: string, delta: number) => {
    if (!userId) return;

    try {
      await updateDoc(doc(db, 'teams', teamId), {
        points: increment(delta)
      });
    } catch (error) {
      console.error("Ошибка обновления очков:", error);
      if (isTGWebView) {
        window.Telegram?.WebApp.showAlert("Не удалось изменить очки");
      } else {
        alert("Не удалось изменить очки");
      }
    }
  }, [userId, isTGWebView]);

  const handleVoiceCommand = useCallback(async (command: string) => {
    if (!userId) return;

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
  }, [teams, updateTeamPoints, userId]);

  const createTeams = useCallback(async () => {
    if (!userId) {
      if (isTGWebView) {
        window.Telegram?.WebApp.showAlert("Требуется авторизация в Telegram");
      } else {
        alert("Требуется авторизация");
      }
      return;
    }

    if (teamCount === 0 || peopleCount === 0) {
      if (isTGWebView) {
        window.Telegram?.WebApp.showAlert("Количество команд и участников должно быть больше 0");
      } else {
        alert("Количество команд и участников должно быть больше 0");
      }
      return;
    }
    
    const people = Array.from({length: peopleCount}, (_, i) => i + 1);
    const shuffled = [...people].sort(() => 0.5 - Math.random());
    
    const batch = writeBatch(db);
    
    const teamsQuery = query(
      collection(db, 'teams'),
      where('ownerId', '==', userId)
    );
    const snapshot = await getDocs(teamsQuery);
    snapshot.forEach(doc => {
      batch.delete(doc.ref);
    });
    
    for (let i = 0; i < teamCount; i++) {
      const members = shuffled.slice(
        Math.floor(i * shuffled.length / teamCount),
        Math.floor((i + 1) * shuffled.length / teamCount)
      );
      
      const teamRef = doc(collection(db, 'teams'));
      batch.set(teamRef, {
        name: `Команда ${i + 1}`,
        members,
        points: 0,
        ownerId: userId
      });
    }
    
    try {
      await batch.commit();
      setShowTeamCreator(false);
      setTeamCount(2);
      setPeopleCount(4);
    } catch (error) {
      console.error("Ошибка создания команд:", error);
      if (isTGWebView) {
        window.Telegram?.WebApp.showAlert("Ошибка при создании команд");
      } else {
        alert("Ошибка при создании команд");
      }
    }
  }, [userId, teamCount, peopleCount, isTGWebView]);

  const toggleTeamExpansion = useCallback((teamId: string) => {
    setTeams(prevTeams => 
      prevTeams.map(team => 
        team.id === teamId ? {...team, expanded: !team.expanded} : team
      )
    );
  }, []);

  const handleTeamCountChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value === '' || /^\d+$/.test(value)) {
      setTeamCount(value === '' ? 0 : parseInt(value));
    }
  }, []);

  const handlePeopleCountChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value === '' || /^\d+$/.test(value)) {
      setPeopleCount(value === '' ? 0 : parseInt(value));
    }
  }, []);

  const handleMicClick = useCallback(() => {
    if (isTGWebView && !micPermissionGranted) {
      window.Telegram?.WebApp.showAlert("Пожалуйста, разрешите доступ к микрофону в настройках Telegram");
      return;
    }
    setIsListening(prev => !prev);
  }, [isTGWebView, micPermissionGranted]);

  const handleLogout = useCallback(() => {
    if (isTGWebView && window.Telegram?.WebApp) {
      window.Telegram.WebApp.close();
    } else {
      setUserId(null);
      setUserData(null);
    }
  }, [isTGWebView]);

  if (!isSupported) {
    return (
      <div className="browser-warning">
        Ваш браузер не поддерживает голосовое управление.
        Попробуйте Google Chrome или Microsoft Edge.
      </div>
    );
  }

  if (!initialAuthCheck) {
    return <div className="auth-checking">Загрузка...</div>;
  }

  if (!userId && isTGWebView) {
    return <AuthWarning isTGWebView={true} onAuthSuccess={handleAuthSuccess} />;
  }

  if (!isTGWebView) {
    return (
      <div className="auth-container">
        <div className="auth-content">
          <h2>Это приложение работает только в Telegram</h2>
          <p>Пожалуйста, откройте его через Telegram бота</p>
          <button 
            onClick={() => window.open('https://t.me/TeamsWebApp_bot/webapp', '_blank')}
            className="auth-button"
          >
            Открыть приложение
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="voice-assistant-container">
      <div className="user-header">
        {userData?.photoUrl && (
          <img src={userData.photoUrl} alt="User" className="user-avatar" />
        )}
        <div className="user-info">
          <span className="user-name">{userData?.name}</span>
          {userData?.username && (
            <span className="user-username">@{userData.username}</span>
          )}
        </div>
        <button onClick={handleLogout} className="logout-button">
          <svg viewBox="0 0 24 24" width="20" height="20">
            <path fill="currentColor" d="M16 17v-3H5v-4h11V7l5 5-5 5M14 2a2 2 0 0 1 2 2v2h-2V4H5v16h9v-2h2v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9z"/>
          </svg>
        </button>
      </div>

      <button 
        className="team-creator-button"
        onClick={() => setShowTeamCreator(true)}
        aria-label="Создать команды"
        disabled={!userId}
      >
        <svg className="team-icon" viewBox="0 0 24 24">
          <path fill="currentColor" d="M16 17V19H2V17S2 13 9 13 16 17 16 17M12.5 7.5A3.5 3.5 0 1 0 9 11A3.5 3.5 0 0 0 12.5 7.5M15.94 13A5.32 5.32 0 0 1 18 17V19H22V17S22 13.37 15.94 13M15 4A3.39 3.39 0 0 0 13.07 4.59A5 5 0 0 1 13.07 10.41A3.39 3.39 0 0 0 15 11A3.5 3.5 0 0 0 15 4Z"/>
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
              disabled={!userId || (isTGWebView && !micPermissionGranted)}
            >
              <svg className="mic-icon" viewBox="0 0 24 24">
                <path fill="currentColor" d="M12,2A3,3 0 0,1 15,5V11A3,3 0 0,1 12,14A3,3 0 0,1 9,11V5A3,3 0 0,1 12,2M19,11C19,14.53 16.39,17.44 13,17.93V21H11V17.93C7.61,17.44 5,14.53 5,11H7A5,5 0 0,0 12,16A5,5 0 0,0 17,11H19Z"/>
              </svg>
            </button>
            <div className="mic-status">
              {isTGWebView && !micPermissionGranted 
                ? "Разрешите микрофон в настройках" 
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
                  onClick={() => setTeamCount(Math.max(0, teamCount - 1))}
                  className="number-control minus"
                >
                  −
                </button>
                <input 
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={teamCount === 0 ? '' : teamCount}
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
                  onClick={() => setPeopleCount(Math.max(0, peopleCount - 1))}
                  className="number-control minus"
                >
                  −
                </button>
                <input 
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={peopleCount === 0 ? '' : peopleCount}
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
                onClick={() => {
                  setShowTeamCreator(false);
                  setTeamCount(2);
                  setPeopleCount(4);
                }} 
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