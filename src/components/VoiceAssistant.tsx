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

const TELEGRAM_BOT_USERNAME = 'TeamsWebApp_bot';
const BACKEND_SERVER_URL = 'http://localhost:3000';
const DEFAULT_TEAM_COUNT = 2;
const DEFAULT_PEOPLE_COUNT = 4;
const AUTH_CHECK_INTERVAL = 1000;
const MICROPHONE_PERMISSION = 'microphone';

enum AuthenticationStatus {
  Idle = 'idle',
  Pending = 'pending',
  Success = 'success',
  Failed = 'failed'
}

interface TeamData {
  id: string;
  name: string;
  members: number[];
  points: number;
  expanded: boolean;
  ownerId: string;
}

interface UserProfileData {
  name: string;
  username?: string;
  photoUrl?: string;
}

interface TelegramUserData {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
}

interface AuthWarningProps {
  isTelegramWebView: boolean;
  onAuthenticationSuccess: (user: { 
    id: string; 
    first_name?: string; 
    last_name?: string; 
    username?: string 
  }) => void;
}

declare global {
  interface Window {
    Telegram?: {
      WebApp: {
        initData: string;
        initDataUnsafe: {
          user?: TelegramUserData;
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

const AuthWarningComponent: React.FC<AuthWarningProps> = ({ 
  isTelegramWebView, 
  onAuthenticationSuccess 
}) => {
  const [authenticationStatus, setAuthenticationStatus] = useState<AuthenticationStatus>(
    AuthenticationStatus.Idle
  );

  const handleAuthenticationClick = useCallback(() => {
    if (!isTelegramWebView) {
      console.error('Приложение не запущено в Telegram WebView');
      return;
    }
    
    setAuthenticationStatus(AuthenticationStatus.Pending);
    const authenticationToken = `webapp_${Date.now()}`;
    
    try {
      if (window.Telegram?.WebApp?.openTelegramLink) {
        window.Telegram.WebApp.openTelegramLink(
          `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${authenticationToken}`
        );
      } else {
        window.open(
          `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${authenticationToken}`,
          '_blank'
        );
      }
    } catch (error) {
      console.error('Ошибка при открытии ссылки Telegram:', error);
      setAuthenticationStatus(AuthenticationStatus.Failed);
    }
  }, [isTelegramWebView]);

  useEffect(() => {
    if (authenticationStatus !== AuthenticationStatus.Pending) return;

    const verifyAuthenticationStatus = async () => {
      try {
        const initializationData = window.Telegram?.WebApp?.initData;
        if (!initializationData) {
          console.log('Данные инициализации отсутствуют');
          return;
        }

        const authenticationResponse = await fetch(
          `${BACKEND_SERVER_URL}/auth/telegram`, 
          {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'Accept': 'application/json'
            },
            body: JSON.stringify({ initData: initializationData })
          }
        );

        if (!authenticationResponse.ok) {
          throw new Error(`HTTP ошибка! Статус: ${authenticationResponse.status}`);
        }

        const userInformation = await authenticationResponse.json();
        
        if (userInformation && userInformation.id) {
          onAuthenticationSuccess({
            id: userInformation.id.toString(),
            first_name: userInformation.first_name,
            last_name: userInformation.last_name,
            username: userInformation.username
          });
          setAuthenticationStatus(AuthenticationStatus.Success);
        } else {
          setAuthenticationStatus(AuthenticationStatus.Failed);
        }
      } catch (authenticationError) {
        console.error('Ошибка проверки авторизации:', authenticationError);
        setAuthenticationStatus(AuthenticationStatus.Failed);
      }
    };

    const authenticationCheckInterval = setInterval(
      verifyAuthenticationStatus, 
      AUTH_CHECK_INTERVAL
    );
    
    return () => clearInterval(authenticationCheckInterval);
  }, [authenticationStatus, onAuthenticationSuccess]);

  return (
    <div className="authentication-container">
      <div className="authentication-content">
        <h2 className="authentication-title">Требуется авторизация</h2>
        
        {authenticationStatus === AuthenticationStatus.Pending ? (
          <div className="authentication-pending-state">
            <div className="authentication-loader"></div>
            <p className="authentication-message">
              Пожалуйста, завершите авторизацию в Telegram
            </p>
            <p className="authentication-instruction">
              После авторизации нажмите кнопку ниже
            </p>
            <button 
              onClick={() => window.location.reload()} 
              className="authentication-button"
              disabled={authenticationStatus !== AuthenticationStatus.Pending}
            >
              Я авторизовался
            </button>
          </div>
        ) : (
          <div className="authentication-idle-state">
            <p className="authentication-description">
              Для использования приложения необходимо войти через Telegram
            </p>
            <button 
              onClick={handleAuthenticationClick} 
              className="authentication-button telegram-button"
              disabled={authenticationStatus !== AuthenticationStatus.Idle}
            >
              Войти через Telegram
            </button>
          </div>
        )}

        {authenticationStatus === AuthenticationStatus.Failed && (
          <div className="authentication-error-state">
            <p className="authentication-error-message">
              Ошибка авторизации. Пожалуйста, попробуйте снова.
            </p>
            {window.Telegram?.WebApp && (
              <button 
                onClick={() => window.Telegram?.WebApp?.showAlert(
                  "Попробуйте перезагрузить страницу или обратитесь в поддержку"
                )}
                className="authentication-help-button"
              >
                Нужна помощь?
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const VoiceAssistantApplication: React.FC = () => {
  const [isVoiceRecognitionActive, setIsVoiceRecognitionActive] = useState<boolean>(false);
  const [recognizedText, setRecognizedText] = useState<string>('');
  const [isVoiceRecognitionSupported, setIsVoiceRecognitionSupported] = useState<boolean>(true);
  const [isTeamCreatorVisible, setIsTeamCreatorVisible] = useState<boolean>(false);
  const [numberOfTeams, setNumberOfTeams] = useState<number>(DEFAULT_TEAM_COUNT);
  const [numberOfParticipants, setNumberOfParticipants] = useState<number>(DEFAULT_PEOPLE_COUNT);
  const [teamsList, setTeamsList] = useState<TeamData[]>([]);
  const [isTelegramWebView, setIsTelegramWebView] = useState<boolean>(false);
  const [hasMicrophonePermission, setHasMicrophonePermission] = useState<boolean>(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserData, setCurrentUserData] = useState<UserProfileData | null>(null);
  const [isInitialAuthCheckComplete, setIsInitialAuthCheckComplete] = useState<boolean>(false);

  const microphoneButtonRef = useRef<HTMLButtonElement>(null);

  const handleSuccessfulAuthentication = useCallback((telegramUser: { 
    id: string; 
    first_name?: string; 
    last_name?: string; 
    username?: string 
  }) => {
    setCurrentUserId(telegramUser.id);
    setCurrentUserData({
      name: [telegramUser.first_name, telegramUser.last_name].filter(Boolean).join(' '),
      username: telegramUser.username
    });
    
    if (window.Telegram?.WebApp) {
      window.Telegram.WebApp.disableClosingConfirmation();
    }
  }, []);

  const handleBackButtonPress = useCallback(() => {
    if (window.Telegram?.WebApp) {
      window.Telegram.WebApp.close();
    }
  }, []);

  const handleThemeChange = useCallback(() => {
    if (window.Telegram?.WebApp) {
      const isDarkTheme = window.Telegram.WebApp.colorScheme === 'dark';
      document.body.classList.toggle('telegram-dark-theme', isDarkTheme);
      document.body.style.backgroundColor = isDarkTheme ? '#212121' : '#ffffff';
    }
  }, []);

  const performInitialAuthCheck = useCallback(async () => {
    const initializationData = window.Telegram?.WebApp?.initData;
    if (!initializationData || currentUserId) return;

    try {
      const authResponse = await fetch(
        `${BACKEND_SERVER_URL}/auth/telegram`, 
        {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({ initData: initializationData })
        }
      );

      if (authResponse.ok) {
        const userData = await authResponse.json();
        if (userData && userData.id) {
          handleSuccessfulAuthentication(userData);
        }
      }
    } catch (authError) {
      console.error('Ошибка начальной проверки авторизации:', authError);
    } finally {
      setIsInitialAuthCheckComplete(true);
    }
  }, [currentUserId, handleSuccessfulAuthentication]);

  useEffect(() => {
    const userAgentString = navigator.userAgent.toLowerCase();
    const isTelegramEnvironment = userAgentString.includes('telegram');
    setIsTelegramWebView(isTelegramEnvironment);

    if (isTelegramEnvironment && window.Telegram?.WebApp) {
      const telegramWebAppInstance = window.Telegram.WebApp;
      
      telegramWebAppInstance.expand();
      telegramWebAppInstance.enableClosingConfirmation();

      performInitialAuthCheck();

      telegramWebAppInstance.BackButton.show();
      telegramWebAppInstance.BackButton.onClick(handleBackButtonPress);

      telegramWebAppInstance.requestPermission(
        MICROPHONE_PERMISSION, 
        (isPermissionGranted) => {
          setHasMicrophonePermission(isPermissionGranted);
          if (!isPermissionGranted) {
            telegramWebAppInstance.showAlert(
              "Для работы голосового ассистента разрешите доступ к микрофону в настройках Telegram"
            );
          }
        }
      );

      telegramWebAppInstance.onEvent('themeChanged', handleThemeChange);
      handleThemeChange();

      return () => {
        telegramWebAppInstance.offEvent('themeChanged', handleThemeChange);
        telegramWebAppInstance.BackButton.offClick(handleBackButtonPress);
      };
    } else {
      setHasMicrophonePermission(true);
      setIsInitialAuthCheckComplete(true);
    }
  }, [performInitialAuthCheck, handleBackButtonPress, handleThemeChange]);

  useEffect(() => {
    if (!currentUserId) return;

    const teamsQuery = query(
      collection(db, 'teams'),
      where('ownerId', '==', currentUserId)
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
      setTeamsList(loadedTeams);
    });

    return () => unsubscribe();
  }, [currentUserId]);

  useEffect(() => {
    if (!hasMicrophonePermission) return;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setIsVoiceRecognitionSupported(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'ru-RU';
    recognition.interimResults = false;
    recognition.continuous = true;

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      setRecognizedText(transcript);
      handleVoiceCommand(transcript);
    };

    recognition.onerror = (event) => {
      console.error('Ошибка распознавания:', event.error);
      if (event.error === 'no-speech' && isVoiceRecognitionActive) {
        recognition.start();
      }
    };

    if (isVoiceRecognitionActive) {
      recognition.start();
    }

    return () => {
      recognition.stop();
    };
  }, [isVoiceRecognitionActive, hasMicrophonePermission]);

  const updateTeamPoints = useCallback(async (teamId: string, pointsDelta: number) => {
    if (!currentUserId) return;

    try {
      await updateDoc(doc(db, 'teams', teamId), {
        points: increment(pointsDelta)
      });
    } catch (error) {
      console.error("Ошибка обновления очков:", error);
      if (isTelegramWebView) {
        window.Telegram?.WebApp.showAlert("Не удалось изменить очки");
      } else {
        alert("Не удалось изменить очки");
      }
    }
  }, [currentUserId, isTelegramWebView]);

  const handleVoiceCommand = useCallback(async (command: string) => {
    if (!currentUserId) return;

    const normalizedCommand = command.toLowerCase().trim();
    const commandPattern = /команда\s+(\d+)\s+(плюс|минус|\+|\-)\s*(\d+)/i;
    const match = normalizedCommand.match(commandPattern);
    
    if (match && teamsList.length > 0) {
      const teamNumber = parseInt(match[1]);
      const operator = match[2];
      let points = parseInt(match[3]);
      
      if (operator === 'минус' || operator === '-') {
        points = -points;
      }
      
      const teamToUpdate = teamsList.find(team => team.name === `Команда ${teamNumber}`);
      
      if (teamToUpdate) {
        await updateTeamPoints(teamToUpdate.id, points);
        setRecognizedText(`Выполнено: ${command}`);
      } else {
        setRecognizedText(`Ошибка: команды ${teamNumber} не существует`);
      }
    } else {
      setRecognizedText(`Не распознано: ${command}`);
    }
  }, [teamsList, updateTeamPoints, currentUserId]);

  const createTeams = useCallback(async () => {
    if (!currentUserId) {
      if (isTelegramWebView) {
        window.Telegram?.WebApp.showAlert("Требуется авторизация в Telegram");
      } else {
        alert("Требуется авторизация");
      }
      return;
    }

    if (numberOfTeams === 0 || numberOfParticipants === 0) {
      if (isTelegramWebView) {
        window.Telegram?.WebApp.showAlert("Количество команд и участников должно быть больше 0");
      } else {
        alert("Количество команд и участников должно быть больше 0");
      }
      return;
    }
    
    const people = Array.from({length: numberOfParticipants}, (_, index) => index + 1);
    const shuffledPeople = [...people].sort(() => 0.5 - Math.random());
    
    const batch = writeBatch(db);
    
    const teamsQuery = query(
      collection(db, 'teams'),
      where('ownerId', '==', currentUserId)
    );
    const snapshot = await getDocs(teamsQuery);
    snapshot.forEach(doc => {
      batch.delete(doc.ref);
    });
    
    for (let i = 0; i < numberOfTeams; i++) {
      const startIndex = Math.floor(i * shuffledPeople.length / numberOfTeams);
      const endIndex = Math.floor((i + 1) * shuffledPeople.length / numberOfTeams);
      const teamMembers = shuffledPeople.slice(startIndex, endIndex);
      
      const teamRef = doc(collection(db, 'teams'));
      batch.set(teamRef, {
        name: `Команда ${i + 1}`,
        members: teamMembers,
        points: 0,
        ownerId: currentUserId
      });
    }
    
    try {
      await batch.commit();
      setIsTeamCreatorVisible(false);
      setNumberOfTeams(DEFAULT_TEAM_COUNT);
      setNumberOfParticipants(DEFAULT_PEOPLE_COUNT);
    } catch (error) {
      console.error("Ошибка создания команд:", error);
      if (isTelegramWebView) {
        window.Telegram?.WebApp.showAlert("Ошибка при создании команд");
      } else {
        alert("Ошибка при создании команд");
      }
    }
  }, [currentUserId, numberOfTeams, numberOfParticipants, isTelegramWebView]);

  const toggleTeamExpansion = useCallback((teamId: string) => {
    setTeamsList(prevTeams => 
      prevTeams.map(team => 
        team.id === teamId ? {...team, expanded: !team.expanded} : team
      )
    );
  }, []);

  const handleTeamCountChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const inputValue = event.target.value;
    if (inputValue === '' || /^\d+$/.test(inputValue)) {
      setNumberOfTeams(inputValue === '' ? 0 : parseInt(inputValue));
    }
  }, []);

  const handlePeopleCountChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const inputValue = event.target.value;
    if (inputValue === '' || /^\d+$/.test(inputValue)) {
      setNumberOfParticipants(inputValue === '' ? 0 : parseInt(inputValue));
    }
  }, []);

  const handleMicrophoneClick = useCallback(() => {
    if (isTelegramWebView && !hasMicrophonePermission) {
      window.Telegram?.WebApp.showAlert("Пожалуйста, разрешите доступ к микрофону в настройках Telegram");
      return;
    }
    setIsVoiceRecognitionActive(prevState => !prevState);
  }, [isTelegramWebView, hasMicrophonePermission]);

  const handleLogout = useCallback(() => {
    if (isTelegramWebView && window.Telegram?.WebApp) {
      window.Telegram.WebApp.close();
    } else {
      setCurrentUserId(null);
      setCurrentUserData(null);
    }
  }, [isTelegramWebView]);

  if (!isVoiceRecognitionSupported) {
    return (
      <div className="browser-compatibility-warning">
        <h3 className="warning-title">Несовместимый браузер</h3>
        <p className="warning-message">
          Ваш браузер не поддерживает функциональность голосового управления.
          Для полноценной работы приложения рекомендуется использовать:
        </p>
        <ul className="recommended-browsers-list">
          <li>Google Chrome последней версии</li>
          <li>Microsoft Edge последней версии</li>
          <li>Mozilla Firefox последней версии</li>
        </ul>
      </div>
    );
  }

  if (!isInitialAuthCheckComplete) {
    return (
      <div className="initial-loading-screen">
        <div className="loading-animation">
          <div className="loading-spinner"></div>
          <div className="loading-spinner"></div>
          <div className="loading-spinner"></div>
        </div>
        <p className="loading-message">Идет проверка авторизации...</p>
      </div>
    );
  }

  if (!currentUserId && isTelegramWebView) {
    return (
      <AuthWarningComponent 
        isTelegramWebView={true} 
        onAuthenticationSuccess={handleSuccessfulAuthentication} 
      />
    );
  }

  if (!isTelegramWebView) {
    return (
      <div className="telegram-required-container">
        <div className="telegram-required-content">
          <h2 className="platform-warning-title">
            Это приложение предназначено для работы в Telegram
          </h2>
          <p className="platform-warning-message">
            Пожалуйста, откройте приложение через Telegram бота для получения 
            полного функционала
          </p>
          <button 
            onClick={() => window.open(
              `https://t.me/${TELEGRAM_BOT_USERNAME}/webapp`, 
              '_blank'
            )}
            className="open-in-telegram-button"
          >
            Открыть в Telegram
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="voice-assistant-application-container">
      <div className="user-header-section">
        {currentUserData?.photoUrl && (
          <img 
            src={currentUserData.photoUrl} 
            alt="User Profile" 
            className="user-profile-image" 
          />
        )}
        <div className="user-info-section">
          <span className="user-full-name">{currentUserData?.name}</span>
          {currentUserData?.username && (
            <span className="user-username">@{currentUserData.username}</span>
          )}
        </div>
        <button 
          onClick={handleLogout} 
          className="logout-action-button"
          aria-label="Выйти из аккаунта"
        >
          <svg viewBox="0 0 24 24" width="20" height="20">
            <path 
              fill="currentColor" 
              d="M16 17v-3H5v-4h11V7l5 5-5 5M14 2a2 2 0 0 1 2 2v2h-2V4H5v16h9v-2h2v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9z"
            />
          </svg>
        </button>
      </div>

      <button 
        className="team-creation-button"
        onClick={() => setIsTeamCreatorVisible(true)}
        aria-label="Создать новые команды"
        disabled={!currentUserId}
      >
        <svg className="team-icon" viewBox="0 0 24 24">
          <path 
            fill="currentColor" 
            d="M16 17V19H2V17S2 13 9 13 16 17 16 17M12.5 7.5A3.5 3.5 0 1 0 9 11A3.5 3.5 0 0 0 12.5 7.5M15.94 13A5.32 5.32 0 0 1 18 17V19H22V17S22 13.37 15.94 13M15 4A3.39 3.39 0 0 0 13.07 4.59A5 5 0 0 1 13.07 10.41A3.39 3.39 0 0 0 15 11A3.5 3.5 0 0 0 15 4Z"
          />
        </svg>
      </button>

      <div className="main-application-interface">
        {teamsList.length > 0 ? (
          <div className="teams-ranking-section">
            <h2 className="teams-ranking-title">Рейтинг команд</h2>
            <div className="teams-list-container">
              {[...teamsList].sort((a, b) => b.points - a.points).map((team) => (
                <div key={team.id} className="team-item-container">
                  <div 
                    className="team-header-section"
                    onClick={() => toggleTeamExpansion(team.id)}
                    aria-expanded={team.expanded}
                  >
                    <span className="team-name-text">{team.name}</span>
                    <span className="team-points-count">{team.points} очков</span>
                    <span className="team-expansion-toggle">
                      {team.expanded ? '▲' : '▼'}
                    </span>
                  </div>
                  {team.expanded && (
                    <div className="team-details-section">
                      <h4 className="team-members-title">Участники:</h4>
                      <ul className="team-members-list">
                        {team.members.map((member) => (
                          <li key={member} className="team-member-item">
                            {member}
                          </li>
                        ))}
                      </ul>
                      <div className="team-controls-section">
                        <button 
                          className="points-adjustment-button decrease-points"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            updateTeamPoints(team.id, -1);
                          }}
                          aria-label="Уменьшить очки на 1"
                        >
                          -1
                        </button>
                        <button 
                          className="points-adjustment-button increase-points"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            updateTeamPoints(team.id, 1);
                          }}
                          aria-label="Увеличить очки на 1"
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
          <div className="no-teams-message-container">
            <p className="no-teams-message-text">
              Создайте свои первые команды, нажав на кнопку выше
            </p>
          </div>
        )}

        <div className="voice-control-section">
          <div className="microphone-control-container">
            <button 
              ref={microphoneButtonRef}
              onClick={handleMicrophoneClick}
              className={`microphone-button ${isVoiceRecognitionActive ? 'active' : ''}`}
              aria-label={isVoiceRecognitionActive ? 'Остановить запись' : 'Начать запись'}
              disabled={!currentUserId || (isTelegramWebView && !hasMicrophonePermission)}
            >
              <svg className="microphone-icon" viewBox="0 0 24 24">
                <path 
                  fill="currentColor" 
                  d="M12,2A3,3 0 0,1 15,5V11A3,3 0 0,1 12,14A3,3 0 0,1 9,11V5A3,3 0 0,1 12,2M19,11C19,14.53 16.39,17.44 13,17.93V21H11V17.93C7.61,17.44 5,14.53 5,11H7A5,5 0 0,0 12,16A5,5 0 0,0 17,11H19Z"
                />
              </svg>
            </button>
            <div className="microphone-status-text">
              {isTelegramWebView && !hasMicrophonePermission 
                ? "Разрешите доступ к микрофону в настройках" 
                : isVoiceRecognitionActive 
                  ? "Идет запись голоса..." 
                  : "Нажмите для голосового управления"}
            </div>
          </div>

          <div className="voice-recognition-output">
            <h3 className="recognition-results-title">Распознанный текст:</h3>
            <div className="recognition-text-container">
              {recognizedText || (
                <span className="recognition-placeholder">
                  Здесь будет отображаться распознанная голосовая команда
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {isTeamCreatorVisible && (
        <div className="modal-overlay-background">
          <div className="team-creation-modal">
            <h3 className="modal-title">Создание команд</h3>
            
            <div className="input-control-group">
              <label className="input-label">Количество команд:</label>
              <div className="number-input-control">
                <button 
                  onClick={() => setNumberOfTeams(prev => Math.max(0, prev - 1))}
                  className="number-control-button decrease-button"
                  aria-label="Уменьшить количество команд"
                >
                  −
                </button>
                <input 
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={numberOfTeams === 0 ? '' : numberOfTeams}
                  onChange={handleTeamCountChange}
                  className="number-input-field"
                  aria-label="Количество команд"
                />
                <button 
                  onClick={() => setNumberOfTeams(prev => prev + 1)}
                  className="number-control-button increase-button"
                  aria-label="Увеличить количество команд"
                >
                  +
                </button>
              </div>
            </div>
            
            <div className="input-control-group">
              <label className="input-label">Количество участников:</label>
              <div className="number-input-control">
                <button 
                  onClick={() => setNumberOfParticipants(prev => Math.max(0, prev - 1))}
                  className="number-control-button decrease-button"
                  aria-label="Уменьшить количество участников"
                >
                  −
                </button>
                <input 
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={numberOfParticipants === 0 ? '' : numberOfParticipants}
                  onChange={handlePeopleCountChange}
                  className="number-input-field"
                  aria-label="Количество участников"
                />
                <button 
                  onClick={() => setNumberOfParticipants(prev => prev + 1)}
                  className="number-control-button increase-button"
                  aria-label="Увеличить количество участников"
                >
                  +
                </button>
              </div>
            </div>
            
            <div className="modal-actions-container">
              <button 
                onClick={createTeams} 
                className="modal-action-button confirm-button"
              >
                Создать команды
              </button>
              <button 
                onClick={() => {
                  setIsTeamCreatorVisible(false);
                  setNumberOfTeams(DEFAULT_TEAM_COUNT);
                  setNumberOfParticipants(DEFAULT_PEOPLE_COUNT);
                }} 
                className="modal-action-button cancel-button"
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

export default VoiceAssistantApplication;