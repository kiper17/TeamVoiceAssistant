import { useState, useEffect, useRef, useCallback } from 'react';
import { 
  collection, doc, updateDoc, 
  getDocs, deleteDoc, onSnapshot, 
  increment, writeBatch, query, where,
  setDoc, getDoc, runTransaction
} from 'firebase/firestore';
import { getAuth, signInAnonymously, signOut } from 'firebase/auth';
import { db, auth } from '../firebase';
import './VoiceAssistant.css';

type Team = {
  id: string;
  name: string;
  members: number[];
  points: number;
  expanded: boolean;
  ownerId: string;
  createdAt?: string;
  lastAccessed?: string;
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
  const [micStatus, setMicStatus] = useState<'idle'|'requested'|'granted'|'denied'>('idle');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [username, setUsername] = useState('');
  const [showAuthForm, setShowAuthForm] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const buttonRef = useRef<HTMLButtonElement>(null);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') {
      setIsDarkMode(true);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('theme', isDarkMode ? 'dark' : 'light');
    document.body.className = isDarkMode ? 'dark-mode' : '';
  }, [isDarkMode]);

  useEffect(() => {
    // Проверка поддержки браузера с учетом мобильных устройств
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const isChrome = /Chrome/i.test(navigator.userAgent);
    const isSafari = /Safari/i.test(navigator.userAgent);

    if (!('SpeechRecognition' in window) && !('webkitSpeechRecognition' in window)) {
      setIsSupported(false);
      return;
    }

    // Дополнительные проверки для мобильных устройств
    if (isMobile) {
      if (!isChrome && !isSafari) {
        setIsSupported(false);
        setErrorMessage('Для работы голосового ассистента используйте Chrome или Safari на мобильном устройстве');
        setTimeout(() => setErrorMessage(''), 5000);
        return;
      }

      if (!window.isSecureContext) {
        setIsSupported(false);
        setErrorMessage('Для работы микрофона требуется HTTPS соединение');
        setTimeout(() => setErrorMessage(''), 5000);
        return;
      }
    }
    
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognitionRef.current = new SpeechRecognition();
    recognitionRef.current.lang = 'ru-RU';
    recognitionRef.current.interimResults = false;
    recognitionRef.current.continuous = true;
    recognitionRef.current.maxAlternatives = 3;

    recognitionRef.current.onstart = () => {
      setText('Говорите...');
    };

    recognitionRef.current.onresult = (event: any) => {
      const results = event.results;
      const last = results[results.length - 1];
      const transcript = last[0].transcript.trim();
      
      setText(transcript);
      handleVoiceCommand(transcript);
    };

    recognitionRef.current.onerror = (event: any) => {
      console.error('Ошибка распознавания:', event.error);
      if (event.error === 'not-allowed') {
        setMicPermissionGranted(false);
        setMicStatus('denied');
        setIsListening(false);
      } else if (event.error === 'no-speech') {
        setText('Речь не распознана. Попробуйте еще раз.');
      } else if (event.error === 'audio-capture') {
        setText('Не удалось получить доступ к микрофону.');
      }
    };

    recognitionRef.current.onend = () => {
      if (isListening) {
        try {
          recognitionRef.current?.start();
        } catch (error) {
          console.error('Ошибка перезапуска распознавания:', error);
          setIsListening(false);
        }
      }
    };

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);

  const requestMicPermission = useCallback(async () => {
    if (micStatus === 'granted') return;
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
      setMicPermissionGranted(true);
      setMicStatus('granted');
    } catch (error) {
      console.error('Доступ к микрофону отклонен:', error);
      setMicPermissionGranted(false);
      setMicStatus('denied');
      setErrorMessage('Доступ к микрофону запрещен. Разрешите доступ в настройках браузера.');
      setTimeout(() => setErrorMessage(''), 5000);
    }
  }, [micStatus]);

  useEffect(() => {
    // На мобильных устройствах не запрашиваем разрешение автоматически
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    if (!isMobile) {
      requestMicPermission();
    }
  }, [requestMicPermission]);

  const handleLogin = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) return;

    setIsProcessing(true);
    try {
      const { user } = await signInAnonymously(auth);
      
      const appUser: User = {
        id: user.uid,
        name: username.trim()
      };
      
      setCurrentUser(appUser);
      setShowAuthForm(false);
      localStorage.setItem('currentUser', JSON.stringify(appUser));
    } catch (error) {
      console.error('Ошибка аутентификации:', error);
      setErrorMessage('Ошибка входа. Попробуйте снова');
      setTimeout(() => setErrorMessage(''), 3000);
    } finally {
      setIsProcessing(false);
    }
  }, [username]);

  const handleLogout = useCallback(async () => {
    try {
      await signOut(auth);
      setCurrentUser(null);
      setTeams([]);
      setShowAuthForm(true);
      localStorage.removeItem('currentUser');
      if (isListening) {
        setIsListening(false);
        recognitionRef.current?.stop();
      }
    } catch (error) {
      console.error('Ошибка выхода:', error);
      setErrorMessage('Ошибка при выходе');
      setTimeout(() => setErrorMessage(''), 3000);
    }
  }, [isListening]);

  useEffect(() => {
    const savedUser = localStorage.getItem('currentUser');
    if (savedUser) {
      const user = JSON.parse(savedUser);
      if (auth.currentUser?.uid === user.id) {
        setCurrentUser(user);
        setShowAuthForm(false);
      } else {
        localStorage.removeItem('currentUser');
      }
    }
  }, []);

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
        points: doc.data().points || 0,
        expanded: false,
        ownerId: doc.data().ownerId,
        createdAt: doc.data().createdAt,
        lastAccessed: doc.data().lastAccessed
      }));
      
      // Сортируем команды по очкам
      loadedTeams.sort((a, b) => b.points - a.points);
      
      setTeams(loadedTeams);
    }, (error) => {
      console.error("Ошибка подписки на команды:", error);
      setErrorMessage("Ошибка загрузки команд");
      setTimeout(() => setErrorMessage(''), 3000);
    });

    return () => unsubscribe();
  }, [currentUser]);

  useEffect(() => {
    if (!micPermissionGranted || !currentUser) return;

    if (isListening) {
      try {
        recognitionRef.current?.start();
        setText('Говорите...');
      } catch (error) {
        console.error('Ошибка запуска распознавания:', error);
        setIsListening(false);
      }
    } else {
      recognitionRef.current?.stop();
    }

    return () => {
      recognitionRef.current?.stop();
    };
  }, [isListening, micPermissionGranted, currentUser]);

  const updateTeamPoints = useCallback(async (teamId: string, delta: number) => {
    if (!currentUser || isProcessing) return;

    setIsProcessing(true);
    try {
      await runTransaction(db, async (transaction) => {
        const teamRef = doc(db, 'teams', teamId);
        const teamSnap = await transaction.get(teamRef);
        
        if (!teamSnap.exists()) {
          throw new Error('Команда не найдена');
        }

        const teamData = teamSnap.data();
        if (teamData.ownerId !== currentUser.id) {
          throw new Error('Нет прав для изменения этой команды');
        }

        const currentPoints = teamData.points || 0;
        const newPoints = currentPoints + delta;

        transaction.update(teamRef, {
          points: newPoints,
          lastAccessed: new Date().toISOString()
        });

        // Обновляем локальное состояние
        setTeams(prevTeams => 
          prevTeams.map(team => 
            team.id === teamId 
              ? { ...team, points: newPoints }
              : team
          )
        );
      });
    } catch (error) {
      console.error("Ошибка обновления очков:", error);
      setErrorMessage(error instanceof Error ? error.message : "Не удалось изменить очки");
      setTimeout(() => setErrorMessage(''), 3000);
    } finally {
      setIsProcessing(false);
    }
  }, [currentUser, isProcessing]);

  const handleVoiceCommand = useCallback(async (command: string) => {
    if (!currentUser || teams.length === 0) return;

    const normalizedCommand = command.toLowerCase().trim();
    
    if (normalizedCommand.includes('стоп') || normalizedCommand.includes('хватит')) {
      setIsListening(false);
      setText('Микрофон выключен');
      return;
    }

    if (normalizedCommand.includes('старт') || normalizedCommand.includes('начать')) {
      if (!isListening) {
        setIsListening(true);
        setText('Микрофон включен');
      }
      return;
    }

    const pointsMatch = normalizedCommand.match(
      /(команда|команде|команду)\s+(\d+)\s+(дать|добавить|убрать|снять|плюс|минус|\+|\-)\s*(\d+)?/i
    );

    if (pointsMatch) {
      const teamNumber = parseInt(pointsMatch[2]);
      const operator = pointsMatch[3].toLowerCase();
      let points = parseInt(pointsMatch[4]) || 1;
      
      if (operator.includes('минус') || operator === '-' || operator.includes('убрать') || operator.includes('снять')) {
        points = -points;
      }
      
      const teamToUpdate = teams.find(team => team.name === `Команда ${teamNumber}`);
      
      if (teamToUpdate) {
        try {
          await updateTeamPoints(teamToUpdate.id, points);
          setText(`Команда ${teamNumber}: ${points > 0 ? '+' : ''}${points} очков`);
        } catch (error) {
          setText(`Ошибка изменения очков команды ${teamNumber}`);
        }
      } else {
        setText(`Команда ${teamNumber} не найдена`);
      }
      return;
    }

    // Добавленные новые команды
    if (normalizedCommand.includes('сбросить очки') || normalizedCommand.includes('обнулить')) {
      const teamNumberMatch = normalizedCommand.match(/команда\s+(\d+)/i);
      if (teamNumberMatch) {
        const teamNumber = parseInt(teamNumberMatch[1]);
        const teamToUpdate = teams.find(team => team.name === `Команда ${teamNumber}`);
        if (teamToUpdate) {
          await updateTeamPoints(teamToUpdate.id, -teamToUpdate.points);
          setText(`Очки команды ${teamNumber} сброшены`);
        }
      }
      return;
    }

    if (normalizedCommand.includes('удалить команду') && normalizedCommand.match(/\d+/)) {
      const matchResult = normalizedCommand.match(/\d+/);
      if (matchResult) {
        const teamNumber = parseInt(matchResult[0]);
        setText(`Для удаления команды ${teamNumber} подтвердите действие в интерфейсе`);
        return;
      }
    }

    setText(`Не распознано: "${normalizedCommand}"`);
  }, [currentUser, teams, isListening, updateTeamPoints]);

  const createTeams = useCallback(async () => {
    if (!currentUser) {
      setErrorMessage("Требуется авторизация");
      setTimeout(() => setErrorMessage(''), 3000);
      return;
    }

    if (teamCount < 1 || peopleCount < 1) {
      setErrorMessage("Количество команд и участников должно быть больше 0");
      setTimeout(() => setErrorMessage(''), 3000);
      return;
    }

    setIsProcessing(true);
    setText("Создание команд...");
    
    try {
      const teamsQuery = query(
        collection(db, 'teams'),
        where('ownerId', '==', currentUser.id)
      );
      
      const querySnapshot = await getDocs(teamsQuery);
      const batch = writeBatch(db);
      
      querySnapshot.forEach((doc) => {
        batch.delete(doc.ref);
      });

      const people = Array.from({ length: peopleCount }, (_, i) => i + 1);
      const shuffled = [...people].sort(() => 0.5 - Math.random());

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
          ownerId: currentUser.id,
          createdAt: new Date().toISOString(),
          lastAccessed: new Date().toISOString()
        });
      }

      await batch.commit();
      
      setSuccessMessage(`Успешно создано ${teamCount} команд с ${peopleCount} участниками`);
      setTimeout(() => setSuccessMessage(''), 3000);
      setShowTeamCreator(false);
    } catch (error) {
      console.error("Ошибка создания команд:", error);
      
      let errorMsg = "Ошибка при создании команд";
      if (error instanceof Error) {
        errorMsg = error.message.includes('permission-denied') 
          ? `Ошибка доступа: ${error.message}`
          : error.message.includes('network-error') 
            ? "Ошибка сети. Проверьте подключение к интернету"
            : error.message;
      }
      
      setErrorMessage(errorMsg);
      setTimeout(() => setErrorMessage(''), 5000);
    } finally {
      setIsProcessing(false);
    }
  }, [currentUser, teamCount, peopleCount]);

  const cleanupInactiveTeams = useCallback(async (inactiveDays = 7) => {
    if (!currentUser) return;

    setIsProcessing(true);
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - inactiveDays);

      const teamsQuery = query(
        collection(db, 'teams'),
        where('ownerId', '==', currentUser.id),
        where('lastAccessed', '<', cutoffDate.toISOString())
      );

      const snapshot = await getDocs(teamsQuery);
      const batch = writeBatch(db);
      
      snapshot.forEach(doc => {
        batch.delete(doc.ref);
      });

      await batch.commit();
      setSuccessMessage(`Удалено ${snapshot.size} неактивных команд`);
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (error) {
      console.error("Ошибка очистки неактивных команд:", error);
      setErrorMessage("Не удалось очистить неактивные команды");
      setTimeout(() => setErrorMessage(''), 3000);
    } finally {
      setIsProcessing(false);
    }
  }, [currentUser]);

  const toggleTeamExpansion = useCallback((teamId: string) => {
    setTeams(prevTeams => 
      prevTeams.map(team => 
        team.id === teamId ? {...team, expanded: !team.expanded} : team
      )
    );
  }, []);

  const handleMicClick = useCallback(async () => {
    if (micStatus === 'denied') {
      setErrorMessage('Доступ к микрофону запрещен. Разрешите доступ в настройках браузера.');
      setTimeout(() => setErrorMessage(''), 5000);
      return;
    }

    if (micStatus === 'idle' || micStatus === 'requested') {
      setMicStatus('requested');
      await requestMicPermission();
      return;
    }

    if (micStatus === 'granted') {
      if (!isListening) {
        try {
          recognitionRef.current?.start();
          setIsListening(true);
        } catch (error) {
          console.error('Ошибка запуска распознавания:', error);
          setErrorMessage('Не удалось запустить распознавание речи');
          setTimeout(() => setErrorMessage(''), 5000);
        }
      } else {
        recognitionRef.current?.stop();
        setIsListening(false);
        setText('Микрофон выключен');
      }
    }
  }, [micStatus, isListening, requestMicPermission]);

  const handleTeamCountChange = useCallback((value: number) => {
    setTeamCount(Math.max(1, Math.min(10, value)));
  }, []);

  const handlePeopleCountChange = useCallback((value: number) => {
    setPeopleCount(Math.max(1, Math.min(100, value)));
  }, []);

  const SettingsMenu = () => (
    <div className={`settings-menu ${showSettings ? 'visible' : ''}`}>
      <div className="settings-item" onClick={() => {
        setIsDarkMode(!isDarkMode);
        setShowSettings(false);
      }}>
        <svg viewBox="0 0 24 24" className="icon">
          {isDarkMode ? (
            <path fill="currentColor" d="M12,8A4,4 0 0,0 8,12A4,4 0 0,0 12,16A4,4 0 0,0 16,12A4,4 0 0,0 12,8M12,18A6,6 0 0,1 6,12A6,6 0 0,1 12,6A6,6 0 0,1 18,12A6,6 0 0,1 12,18M20,8.69V4H15.31L12,0.69L8.69,4H4V8.69L0.69,12L4,15.31V20H8.69L12,23.31L15.31,20H20V15.31L23.31,12L20,8.69Z" />
          ) : (
            <path fill="currentColor" d="M12,3A9,9 0 0,0 3,12A9,9 0 0,0 12,21A9,9 0 0,0 21,12A9,9 0 0,0 12,3Z" />
          )}
        </svg>
        {isDarkMode ? 'Светлая тема' : 'Тёмная тема'}
      </div>
    </div>
  );

  if (!isSupported) {
    return (
      <div className="browser-warning">
        <h2>Не поддерживается</h2>
        <p>Ваш браузер не поддерживает голосовое управление.</p>
        <p>Попробуйте Google Chrome или Microsoft Edge.</p>
        {errorMessage && (
          <div className="message error">
            {errorMessage}
          </div>
        )}
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
          <button type="submit" disabled={!username.trim() || isProcessing}>
            {isProcessing ? 'Загрузка...' : 'Войти'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className={`voice-assistant-container ${isDarkMode ? 'dark-mode' : ''}`}>
      {successMessage && (
        <div className="message success">
          {successMessage}
        </div>
      )}
      {errorMessage && (
        <div className="message error">
          {errorMessage.split('\n').map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      )}

      <header className="app-header">
        <div className="user-info-container">
          <div className="user-info">
            <span className="username">Пользователь: {currentUser?.name}</span>
            <button 
              onClick={handleLogout} 
              className="logout-button"
              disabled={isProcessing}
            >
              Выйти
            </button>
          </div>
          <button 
            className="settings-button"
            onClick={() => setShowSettings(!showSettings)}
          >
            <svg viewBox="0 0 24 24" className="icon">
              <path fill="currentColor" d="M12,15.5A3.5,3.5 0 0,1 8.5,12A3.5,3.5 0 0,1 12,8.5A3.5,3.5 0 0,1 15.5,12A3.5,3.5 0 0,1 12,15.5M19.43,12.97C19.47,12.65 19.5,12.33 19.5,12C19.5,11.67 19.47,11.34 19.43,11L21.54,9.37C21.73,9.22 21.78,8.95 21.66,8.73L19.66,5.27C19.54,5.05 19.27,4.96 19.05,5.05L16.56,6.05C16.04,5.66 15.5,5.32 14.87,5.07L14.5,2.42C14.46,2.18 14.25,2 14,2H10C9.75,2 9.54,2.18 9.5,2.42L9.13,5.07C8.5,5.32 7.96,5.66 7.44,6.05L4.95,5.05C4.73,4.96 4.46,5.05 4.34,5.27L2.34,8.73C2.21,8.95 2.27,9.22 2.46,9.37L4.57,11C4.53,11.34 4.5,11.67 4.5,12C4.5,12.33 4.53,12.65 4.57,12.97L2.46,14.63C2.27,14.78 2.21,15.05 2.34,15.27L4.34,18.73C4.46,18.95 4.73,19.03 4.95,18.95L7.44,17.94C7.96,18.34 8.5,18.68 9.13,18.93L9.5,21.58C9.54,21.82 9.75,22 10,22H14C14.25,22 14.46,21.82 14.5,21.58L14.87,18.93C15.5,18.67 16.04,18.34 16.56,17.94L19.05,18.95C19.27,19.03 19.54,18.95 19.66,18.73L21.66,15.27C21.78,15.05 21.73,14.78 21.54,14.63L19.43,12.97Z" />
            </svg>
          </button>
        </div>
        
        <SettingsMenu />
      </header>

      <main className="app-main">
        <div className="teams-section">
          <div className="section-header">
            <h2>Управление командами</h2>
          </div>

          <div className="management-actions">
            <button 
              className="create-teams-button"
              onClick={() => setShowTeamCreator(true)}
              disabled={isProcessing}
            >
              Создать команды
            </button>
            <button 
              className="cleanup-button"
              onClick={() => cleanupInactiveTeams()}
              disabled={isProcessing || teams.length === 0}
            >
              Очистить неактивные
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
                        <div className="team-metadata">
                          <span>Создана: {new Date(team.createdAt || '').toLocaleString()}</span>
                          {team.lastAccessed && (
                            <span>Последняя активность: {new Date(team.lastAccessed).toLocaleString()}</span>
                          )}
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
                disabled={isProcessing}
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
                disabled={micStatus === 'denied' || isProcessing}
              >
                <svg viewBox="0 0 24 24" className="mic-icon">
                  <path fill="currentColor" d="M12,2A3,3 0 0,1 15,5V11A3,3 0 0,1 12,14A3,3 0 0,1 9,11V5A3,3 0 0,1 12,2M19,11C19,14.53 16.39,17.44 13,17.93V21H11V17.93C7.61,17.44 5,14.53 5,11H7A5,5 0 0,0 12,16A5,5 0 0,0 17,11H19Z" />
                </svg>
              </button>
              
              <div className="mic-status">
                {micStatus === 'denied' ? (
                  <span className="warning">Доступ к микрофону запрещен</span>
                ) : micStatus === 'requested' ? (
                  <span className="info">Разрешите доступ к микрофону...</span>
                ) : isListening ? (
                  <span className="active">Слушаю...</span>
                ) : (
                  <span>Нажмите для голосовой команды</span>
                )}
              </div>
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
                disabled={isProcessing}
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
                    disabled={teamCount <= 1 || isProcessing}
                  >
                    -
                  </button>
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={teamCount}
                    onChange={(e) => handleTeamCountChange(parseInt(e.target.value) || 1)}
                    disabled={isProcessing}
                  />
                  <button 
                    onClick={() => handleTeamCountChange(teamCount + 1)}
                    disabled={teamCount >= 10 || isProcessing}
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
                    disabled={peopleCount <= 1 || isProcessing}
                  >
                    -
                  </button>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={peopleCount}
                    onChange={(e) => handlePeopleCountChange(parseInt(e.target.value) || 1)}
                    disabled={isProcessing}
                  />
                  <button 
                    onClick={() => handlePeopleCountChange(peopleCount + 1)}
                    disabled={peopleCount >= 100 || isProcessing}
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
                disabled={isProcessing}
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