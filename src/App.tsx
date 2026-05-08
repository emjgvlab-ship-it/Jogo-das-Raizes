/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Square, 
  Calculator, 
  Trophy, 
  ArrowRight, 
  CheckCircle2, 
  AlertCircle, 
  Info, 
  Fence, 
  DollarSign,
  Maximize,
  HelpCircle
} from 'lucide-react';

import { initializeApp } from 'firebase/app';
import { 
  getFirestore, 
  collection, 
  addDoc, 
  query, 
  orderBy, 
  limit, 
  onSnapshot, 
  serverTimestamp,
  doc,
  getDocFromServer
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

// --- Firebase Initialization ---
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, (firebaseConfig as any).firestoreDatabaseId);

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: null, 
      email: null,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Test connection
async function testConnection() {
  try {
    // Apenas tenta tocar no servidor para verificar se o ID do banco está correto
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    // Erro de permissão é esperado e significa que estamos ONLINE
    if (msg.includes('offline')) {
      console.error("Firebase Offline: Verifique sua conexão.");
    }
    // Não logamos erro de permissão para não confundir o usuário
  }
}
testConnection();

// --- Types ---
type GameState = 'START' | 'EXPLORE' | 'LEVEL1' | 'LEVEL2' | 'LEVEL3' | 'FINISH';

interface LevelResult {
  completed: boolean;
  score: number;
}

// --- Components ---

const RulerPoints = ({ length, orientation = 'horizontal' }: { length: number; orientation?: 'horizontal' | 'vertical' }) => {
  const points = Array.from({ length: Math.floor(length) + 1 }, (_, i) => i);
  const spacing = 100 / length;

  return (
    <div className={`absolute ${orientation === 'horizontal' ? 'left-0 right-0 -bottom-8 flex' : 'top-0 bottom-0 -left-8 flex flex-col'} pointer-events-none`}>
      {points.map((p) => (
        <div 
          key={p} 
          className="absolute flex items-center justify-center translate-x-[-50%] translate-y-[-50%]"
          style={{ 
            left: orientation === 'horizontal' ? `${p * spacing}%` : 'auto',
            top: orientation === 'vertical' ? `${p * spacing}%` : 'auto',
            bottom: orientation === 'horizontal' ? '0' : 'auto',
            right: orientation === 'vertical' ? '0' : 'auto',
          }}
        >
          <div className={`rounded-full bg-slate-300 ${p === 0 || p === Math.floor(length) ? 'w-2 h-2 bg-indigo-400' : 'w-1 h-1'}`} />
        </div>
      ))}
    </div>
  );
};

const PhaseIndicator = ({ currentPhase }: { currentPhase: GameState }) => {
  const phases: { id: GameState; label: string }[] = [
    { id: 'EXPLORE', label: '1. Geometria' },
    { id: 'LEVEL1', label: '2. Exatas' },
    { id: 'LEVEL2', label: '3. Estimativa' },
    { id: 'LEVEL3', label: '4. Jardim' },
  ];

  const getIdx = (state: GameState) => ['START', 'EXPLORE', 'LEVEL1', 'LEVEL2', 'LEVEL3', 'FINISH'].indexOf(state);
  const currentIdx = getIdx(currentPhase);

  if (currentPhase === 'START' || currentPhase === 'FINISH') return null;

  return (
    <div className="w-full max-w-3xl mx-auto mb-4">
      <div className="flex items-center justify-between relative px-2">
        {/* Line */}
        <div className="absolute top-1/2 left-0 w-full h-[2px] bg-neutral-200 -translate-y-1/2 z-0" />
        
        {phases.map((phase, idx) => {
          const phaseIdx = getIdx(phase.id);
          const isActive = phaseIdx === currentIdx;
          const isCompleted = phaseIdx < currentIdx;

          return (
            <div key={phase.id} className="relative z-10 flex flex-col items-center">
              <div 
                className={`w-8 h-8 rounded-full flex items-center justify-center transition-all duration-500 font-bold text-xs ${
                  isActive ? 'bg-indigo-600 text-white ring-4 ring-indigo-100 scale-110' : 
                  isCompleted ? 'bg-emerald-500 text-white' : 'bg-white border-2 border-neutral-200 text-neutral-400'
                }`}
              >
                {isCompleted ? <CheckCircle2 className="w-4 h-4" /> : idx + 1}
              </div>
              <span className={`absolute -bottom-6 whitespace-nowrap text-[10px] font-bold uppercase tracking-wider transition-colors ${
                isActive ? 'text-indigo-600' : 'text-neutral-400'
              }`}>
                {phase.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const Progress = ({ current, total }: { current: number; total: number }) => (
  <div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden">
    <div 
      className="bg-indigo-600 h-full transition-all duration-500" 
      style={{ width: `${(current / total) * 100}%` }}
    />
  </div>
);

// --- Utils ---
const shuffleArray = <T,>(array: T[]): T[] => {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
};

// --- Questions Bank ---
const LEVEL1_BANK = [
  { area: 4, options: [1, 2, 3, 4], correct: 2 },
  { area: 9, options: [2, 3, 4, 5], correct: 3 },
  { area: 16, options: [3, 4, 5, 8], correct: 4 },
  { area: 25, options: [4, 5, 6, 10], correct: 5 },
  { area: 36, options: [5, 6, 7, 9], correct: 6 },
  { area: 49, options: [6, 7, 8, 9], correct: 7 },
  { area: 64, options: [7, 8, 9, 12], correct: 8 },
  { area: 81, options: [7, 8, 9, 10], correct: 9 },
  { area: 100, options: [9, 10, 11, 20], correct: 10 },
  { area: 121, options: [10, 11, 12, 13], correct: 11 },
  { area: 144, options: [11, 12, 13, 14], correct: 12 },
];

const LEVEL2_BANK = [
  { area: 2, between: [1, 2], options: ['1 e 2', '2 e 3', '3 e 4'] },
  { area: 5, between: [2, 3], options: ['1 e 2', '2 e 3', '3 e 4'] },
  { area: 10, between: [3, 4], options: ['2 e 3', '3 e 4', '4 e 5'] },
  { area: 12, between: [3, 4], options: ['2 e 3', '3 e 4', '4 e 5'] },
  { area: 18, between: [4, 5], options: ['3 e 4', '4 e 5', '5 e 6'] },
  { area: 20, between: [4, 5], options: ['3 e 4', '4 e 5', '5 e 6'] },
  { area: 30, between: [5, 6], options: ['4 e 5', '5 e 6', '6 e 7'] },
  { area: 40, between: [6, 7], options: ['5 e 6', '6 e 7', '7 e 8'] },
  { area: 50, between: [7, 8], options: ['6 e 7', '7 e 8', '8 e 9'] },
  { area: 70, between: [8, 9], options: ['7 e 8', '8 e 9', '9 e 10'] },
];

export default function App() {
  const [gameState, setGameState] = useState<GameState>('START');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error', message: string } | null>(null);
  
  // Game Performance State
  const [score, setScore] = useState(0);
  const [playerName, setPlayerName] = useState('');
  const [playerClass, setPlayerClass] = useState('');
  const [hasSavedRecord, setHasSavedRecord] = useState(false);
  const [leaderboard, setLeaderboard] = useState<{name: string, score: number, turma: string, date?: string}[]>([]);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [endTime, setEndTime] = useState<number | null>(null);
  const [questionStartTime, setQuestionStartTime] = useState<number>(Date.now());

  // Randomized Questions State
  const [level1Questions, setLevel1Questions] = useState(LEVEL1_BANK.slice(0, 4));
  const [level2Questions, setLevel2Questions] = useState(LEVEL2_BANK.slice(0, 3));
  const [gardenArea, setGardenArea] = useState(30);

  // Level State
  const [exploreSize, setExploreSize] = useState(5);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [answers, setAnswers] = useState<any[]>([]);

  // Simulation Results
  const [perimInput, setPerimInput] = useState('');
  const [costInput, setCostInput] = useState('');
  const [showCalc, setShowCalc] = useState(false);
  const [calcDisplay, setCalcDisplay] = useState('');
  const [isLocked, setIsLocked] = useState(false);
  const [showLevel4Help, setShowLevel4Help] = useState(false);

  const calcAction = (val: string) => {
    if (val === 'C') setCalcDisplay('');
    else if (val === '=') {
      try {
        // Simple evaluation - replace visual symbols with JS operators
        let expr = calcDisplay
          .replace(/X/g, '*')
          .replace(/÷/g, '/')
          .replace(/√(\d+\.?\d*)/g, 'Math.sqrt($1)');
        // eslint-disable-next-line no-eval
        setCalcDisplay(eval(expr).toString());
      } catch {
        setCalcDisplay('Erro');
      }
    } else if (val === '√') {
      setCalcDisplay(prev => prev + '√');
    } else {
      setCalcDisplay(prev => prev + val);
    }
  };

  // Load leaderboard on mount using Firestore
  useEffect(() => {
    const q = query(
      collection(db, 'leaderboard'),
      orderBy('score', 'desc'),
      limit(5)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const entries = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          name: data.name,
          score: data.score,
          turma: data.turma,
          date: data.createdAt?.toDate ? data.createdAt.toDate().toLocaleDateString('pt-BR') : 'Recente'
        };
      });
      setLeaderboard(entries);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'leaderboard');
    });

    return () => unsubscribe();
  }, []);

  const saveScore = async () => {
    if (!playerName.trim() || hasSavedRecord) return;
    
    try {
      await addDoc(collection(db, 'leaderboard'), {
        name: playerName,
        score: score,
        turma: playerClass,
        createdAt: serverTimestamp()
      });
      setHasSavedRecord(true);
      showFeedback('success', 'Recorde enviado para o mural da escola!');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'leaderboard');
    }
  };

  const startGame = () => {
    setLevel1Questions(shuffleArray(LEVEL1_BANK).slice(0, 5).map(q => ({
      ...q,
      options: shuffleArray(q.options)
    })));
    setLevel2Questions(shuffleArray(LEVEL2_BANK).slice(0, 5).map(q => ({
      ...q,
      options: shuffleArray(q.options)
    })));
    
    // Randomize garden area (Level 3) - Picking areas that are typical for non-exact roots
    const possibleGardenAreas = [10, 12, 15, 18, 20, 24, 30, 40, 45, 50, 75, 80];
    setGardenArea(possibleGardenAreas[Math.floor(Math.random() * possibleGardenAreas.length)]);
    
    setScore(0);
    setHasSavedRecord(false);
    setStartTime(Date.now());
    setQuestionStartTime(Date.now());
    setGameState('EXPLORE');
  };

  const nextLevel = () => {
    setFeedback(null);
    setCurrentQuestion(0);
    setQuestionStartTime(Date.now());
    if (gameState === 'START') startGame();
    else if (gameState === 'EXPLORE') setGameState('LEVEL1');
    else if (gameState === 'LEVEL1') setGameState('LEVEL2');
    else if (gameState === 'LEVEL2') setGameState('LEVEL3');
    else if (gameState === 'LEVEL3') {
      setEndTime(Date.now());
      setGameState('FINISH');
    }
    else if (gameState === 'FINISH') setGameState('START');
  };

  const showFeedback = (type: 'success' | 'error', message: string) => {
    setFeedback({ type, message });
    if (type === 'success') {
      setTimeout(() => {
        setFeedback(null);
      }, 2000);
    }
  };

  const calculateBonus = () => {
    const timeTaken = (Date.now() - questionStartTime) / 1000;
    // Max bonus of 50 points if answered within 5 seconds, decreasing until 20 seconds
    return Math.max(0, Math.floor(50 - (timeTaken * 2)));
  };

  const handleLevel1Answer = (selected: number) => {
    if (isLocked) return;
    if (selected === level1Questions[currentQuestion].correct) {
      const bonus = calculateBonus();
      setScore(s => s + 100 + bonus);
      showFeedback('success', `Correto! +100 pts ${bonus > 0 ? `(+${bonus} bônus tempo)` : ''}`);
      if (currentQuestion < level1Questions.length - 1) {
        setTimeout(() => {
          setCurrentQuestion(q => q + 1);
          setQuestionStartTime(Date.now());
        }, 1000);
      } else {
        setTimeout(nextLevel, 1500);
      }
    } else {
      setIsLocked(true);
      setScore(s => Math.max(0, s - 50));
      showFeedback('error', 'Resposta errada! -50 pts. Aguarde 1s...');
      setTimeout(() => {
        setIsLocked(false);
      }, 1000);
    }
  };

  const handleLevel2Answer = (idx: number) => {
    if (isLocked) return;
    const question = level2Questions[currentQuestion];
    if (question.options[idx] === `${question.between[0]} e ${question.between[1]}`) {
      const bonus = calculateBonus();
      setScore(s => s + 100 + bonus);
      showFeedback('success', `Mandou bem! +100 pts ${bonus > 0 ? `(+${bonus} bônus tempo)` : ''}`);
      if (currentQuestion < level2Questions.length - 1) {
        setTimeout(() => {
          setCurrentQuestion(q => q + 1);
          setQuestionStartTime(Date.now());
        }, 1500);
      } else {
        setTimeout(nextLevel, 2000);
      }
    } else {
      setIsLocked(true);
      setScore(s => Math.max(0, s - 50));
      showFeedback('error', 'Intervalo incorreto. -50 pts. Aguarde 1s...');
      setTimeout(() => {
        setIsLocked(false);
      }, 1000);
    }
  };

  // --- Level 3 Logic: Garden Simulation ---
  const gardenSide = useMemo(() => Math.sqrt(gardenArea).toFixed(2), [gardenArea]);
  const gardenPerimeter = useMemo(() => (Number(gardenSide) * 4).toFixed(2), [gardenSide]);
  const pricePerMeter = 15.50;
  const totalPrice = useMemo(() => (Number(gardenPerimeter) * pricePerMeter).toFixed(2), [gardenPerimeter]);

  const checkGardenResult = () => {
    if (isLocked) return;
    const isPerimCorrect = Math.abs(Number(perimInput) - Number(gardenPerimeter)) < 0.5;
    const isCostCorrect = Math.abs(Number(costInput) - Number(totalPrice)) < 1.0;

    if (isPerimCorrect && isCostCorrect) {
      const bonus = calculateBonus();
      setScore(s => s + 300 + bonus);
      showFeedback('success', `Incrível! Tudo correto! +300 pts`);
      setTimeout(nextLevel, 2000);
    } else {
      setIsLocked(true);
      setScore(s => Math.max(0, s - 100));
      
      let errorMsg = '';
      if (!isPerimCorrect && !isCostCorrect) {
        errorMsg = 'Perímetro e Custo Total incorretos! -100 pts.';
      } else if (!isPerimCorrect) {
        errorMsg = 'Cálculo do Perímetro incorreto! -100 pts.';
      } else {
        errorMsg = 'Cálculo do Custo Total incorreto! -100 pts.';
      }
      
      showFeedback('error', `${errorMsg} Aguarde 1s...`);
      setTimeout(() => {
        setIsLocked(false);
      }, 1000);
    }
  };

  return (
    <div className="h-screen w-full flex flex-col bg-canva-bg font-sans text-slate-800 selection:bg-canva-teal/20 overflow-hidden relative">
      {/* Abstract Background Shapes */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden overflow-hidden">
        <motion.div 
          animate={{ scale: [1, 1.1, 1], rotate: [0, 5, 0] }}
          transition={{ duration: 10, repeat: Infinity }}
          className="absolute -top-32 -left-32 w-96 h-96 bg-canva-teal/10 rounded-full blur-3xl" 
        />
        <motion.div 
          animate={{ scale: [1, 1.2, 1], rotate: [0, -5, 0] }}
          transition={{ duration: 12, repeat: Infinity }}
          className="absolute top-1/3 -right-32 w-80 h-80 bg-canva-purple/10 rounded-full blur-3xl" 
        />
        <div className="absolute bottom-0 left-1/4 w-64 h-64 bg-canva-yellow/10 rounded-full blur-2xl" />
      </div>

      <main className="relative flex-1 max-w-5xl w-full mx-auto px-4 md:px-6 py-4 md:py-6 flex flex-col min-h-0">
        <div className="flex justify-between items-center mb-6 shrink-0">
          <PhaseIndicator currentPhase={gameState} />
          {gameState !== 'START' && gameState !== 'FINISH' && (
            <div className="flex gap-4">
              <div className="bg-white px-6 py-3 rounded-2xl shadow-xl border-4 border-slate-50 flex items-center gap-3">
                <Trophy className="w-5 h-5 text-canva-yellow fill-canva-yellow" />
                <span className="font-black text-xl text-slate-700">{score}</span>
              </div>
            </div>
          )}
        </div>
        
        <AnimatePresence mode="wait">
          
          {/* --- START SCREEN --- */}
          {gameState === 'START' && (
            <motion.div 
              key="start"
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-white rounded-[2.5rem] shadow-2xl p-6 md:p-10 text-center space-y-6 border-8 border-white group overflow-y-auto max-h-full"
            >
              <div className="relative inline-block">
                <motion.div 
                  animate={{ rotate: 360 }}
                  transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
                  className="absolute -inset-4 border-4 border-dashed border-canva-teal/30 rounded-full"
                />
                <div className="relative p-6 rounded-3xl bg-canva-teal text-white shadow-xl shadow-canva-teal/20">
                  <Calculator className="w-16 h-16" />
                </div>
              </div>

              <div className="space-y-2">
                <h1 className="text-4xl md:text-5xl font-bold tracking-tight leading-tight">
                  Laboratório de <span className="text-canva-teal">Raízes</span>
                </h1>
                <p className="text-lg text-slate-500 max-w-2xl mx-auto font-medium">
                  Uma jornada geométrica entre áreas e números irracionais.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-4xl mx-auto pt-2">
                {[
                  { icon: Square, color: 'text-canva-teal', bg: 'bg-canva-teal/10', title: 'Geometria', desc: 'Sinta a área se transformar em lado.' },
                  { icon: Calculator, color: 'text-canva-purple', bg: 'bg-canva-purple/10', title: 'Estimativa', desc: 'Desvende o segredo dos irracionais.' },
                  { icon: Fence, color: 'text-amber-500', bg: 'bg-amber-50', title: 'Prática', desc: 'Crie o Jardim de Pitágoras.' }
                ].map((item, i) => (
                  <motion.div 
                    key={i}
                    whileHover={{ y: -5 }}
                    className="p-6 bg-slate-50 rounded-[2rem] text-left border border-slate-100"
                  >
                    <div className={`inline-flex p-3 rounded-2xl ${item.bg} ${item.color} mb-4`}>
                      <item.icon className="w-6 h-6" />
                    </div>
                    <h3 className="font-bold text-lg mb-1">{item.title}</h3>
                    <p className="text-sm text-slate-500 leading-relaxed">{item.desc}</p>
                  </motion.div>
                ))}
              </div>

              <motion.button 
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={nextLevel}
                className="inline-flex items-center gap-3 px-8 py-4 bg-canva-teal text-white rounded-full font-bold text-lg shadow-2xl shadow-canva-teal/30 hover:bg-canva-teal/90 transition-all"
              >
                Começar Aula Prática
                <ArrowRight className="w-6 h-6" />
              </motion.button>
            </motion.div>
          )}

          {/* --- EXPLORE SCREEN --- */}
          {gameState === 'EXPLORE' && (
            <motion.div 
              key="explore"
              initial={{ opacity: 0, x: 100 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -100 }}
              className="bg-white rounded-[2.5rem] shadow-2xl p-6 md:p-8 space-y-6 border-8 border-white flex-1 min-h-0 flex flex-col overflow-y-auto"
            >
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div className="space-y-1">
                  <h2 className="text-3xl font-bold flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-canva-teal text-white"><Maximize className="w-6 h-6" /></div>
                    Fase 1: O Lado e a Área
                  </h2>
                  <p className="text-slate-500 font-medium ml-12">Arraste o cursor para observar a mudança mágica.</p>
                </div>
                <button onClick={nextLevel} className="px-6 py-2 rounded-full border-2 border-slate-100 font-bold text-slate-400 hover:text-canva-teal hover:border-canva-teal transition-all">
                  Pular Tutorial
                </button>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
                <div className="bg-slate-50 rounded-[2rem] p-6 flex items-center justify-center min-h-[250px] lg:min-h-[350px] border-2 border-dashed border-slate-200">
                  <motion.div 
                    className="bg-canva-teal rounded-3xl shadow-2xl flex items-center justify-center relative ring-8 ring-canva-teal/20"
                    style={{ 
                      width: exploreSize * 25, 
                      height: exploreSize * 25,
                    }}
                    layout
                  >
                    <RulerPoints length={exploreSize} orientation="horizontal" />
                    <RulerPoints length={exploreSize} orientation="vertical" />
                    
                    <motion.div className="text-white text-center">
                      <div className="text-xs font-bold opacity-80 mb-1 leading-tight">ÁREA</div>
                      <div className="text-2xl font-black">
                        {Math.pow(exploreSize, 2).toFixed(1)} <span className="text-sm">m²</span>
                      </div>
                    </motion.div>
                  </motion.div>
                </div>

                <div className="space-y-10">
                  <div className="space-y-4">
                    <h3 className="font-bold text-xl text-slate-700">Controle de Tamanho</h3>
                    <div className="relative pt-6 pb-8">
                      <input 
                        type="range" 
                        min="1" 
                        max="10" 
                        step="0.01" 
                        value={exploreSize}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          const rounded = Math.round(val);
                          const threshold = 0.15; 
                          if (Math.abs(val - rounded) < threshold) {
                            setExploreSize(rounded);
                          } else {
                            setExploreSize(val);
                          }
                        }}
                        className="w-full h-4 bg-slate-100 rounded-full appearance-none cursor-pointer accent-canva-teal relative z-10"
                      />
                      {/* Numeric Ruler (Reta Numérica) */}
                      <div className="absolute top-[34px] left-0 right-0 flex justify-between px-2 pointer-events-none">
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => (
                          <div key={num} className="flex flex-col items-center flex-1">
                            <div className="h-2 w-[2px] bg-slate-200" />
                            <span className="text-[10px] font-bold text-slate-400 mt-1 font-mono">{num}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="p-6 bg-canva-teal/5 rounded-[2rem] border-2 border-canva-teal/10 space-y-3 relative group">
                    <div className="flex items-center gap-3 text-canva-teal font-bold text-lg">
                      <Info className="w-6 h-6" /> 
                      Conceito Chave
                    </div>
                    <p className="text-slate-600 font-medium leading-relaxed">
                      Quando você sabe a área, a <strong>Raiz Quadrada</strong> é a ferramenta mágica que te conta o tamanho do lado!
                    </p>
                    <div className="text-2xl font-bold text-canva-teal font-mono mt-2">
                       L = √{Math.pow(exploreSize, 2).toFixed(1)} = {exploreSize.toFixed(2)}
                    </div>
                  </div>
                  
                  <motion.button 
                    whileHover={{ scale: 1.02 }}
                    onClick={nextLevel}
                    className="w-full py-5 bg-canva-teal text-white rounded-[2rem] font-bold text-lg shadow-xl shadow-canva-teal/20 hover:bg-canva-teal/90"
                  >
                    Próxima Fase! <ArrowRight className="inline w-5 h-5 ml-1" />
                  </motion.button>
                </div>
              </div>
            </motion.div>
          )}

          {/* --- LEVEL 1: EXACT ROOTS --- */}
          {gameState === 'LEVEL1' && (
            <motion.div 
              key="level1"
              initial={{ opacity: 0, x: 100 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -100 }}
              className="bg-white rounded-[2.5rem] shadow-2xl p-6 md:p-8 space-y-6 border-8 border-white flex-1 min-h-0 flex flex-col overflow-y-auto"
            >
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <h2 className="text-3xl font-bold">Fase 2: Quadrados Perfeitos</h2>
                  <p className="text-slate-500 font-medium">Clique no valor correto do lado.</p>
                </div>
                <div className="bg-slate-50 px-4 py-2 rounded-2xl font-bold text-slate-600 border border-slate-100">
                  Questão {currentQuestion + 1} de {level1Questions.length}
                </div>
              </div>

              <div className="flex flex-col items-center gap-10">
                <div className="bg-slate-50 rounded-[2rem] p-6 flex items-center justify-center min-h-[250px] w-full border-2 border-dashed border-slate-200">
                  <motion.div 
                    key={currentQuestion}
                    initial={{ scale: 0, rotate: -10 }}
                    animate={{ scale: 1, rotate: 0 }}
                    className="bg-canva-purple rounded-lg shadow-2xl flex items-center justify-center text-white relative ring-8 ring-canva-purple/20"
                    style={{ 
                      width: level1Questions[currentQuestion].correct * 20, 
                      height: level1Questions[currentQuestion].correct * 20,
                    }}
                  >
                    <RulerPoints length={level1Questions[currentQuestion].correct} orientation="horizontal" />
                    <RulerPoints length={level1Questions[currentQuestion].correct} orientation="vertical" />
                    
                    <div className="text-center">
                      <div className="text-[10px] font-bold opacity-70 uppercase tracking-widest mb-1 leading-tight">ÁREA</div>
                      <div className="text-3xl font-black">{level1Questions[currentQuestion].area} <span className="text-lg">m²</span></div>
                    </div>
                  </motion.div>
                </div>
                
                <h3 className="text-2xl font-bold text-slate-700">Qual é o valor do lado (√{level1Questions[currentQuestion].area})?</h3>

                <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 w-full max-w-3xl">
                  {level1Questions[currentQuestion].options.map((opt) => (
                    <motion.button
                      key={opt}
                      whileHover={{ scale: 1.05, y: -5 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => handleLevel1Answer(opt)}
                      className="py-6 bg-white border-4 border-slate-50 rounded-[2rem] font-bold text-2xl text-slate-700 hover:border-canva-purple hover:text-canva-purple transition-all shadow-xl shadow-slate-200/50"
                    >
                      {opt} m
                    </motion.button>
                  ))}
                </div>
              </div>
            </motion.div>
          )}

          {/* --- LEVEL 2: NON-EXACT ROOTS --- */}
          {gameState === 'LEVEL2' && (
            <motion.div 
              key="level2"
              initial={{ opacity: 0, x: 100 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -100 }}
              className="bg-white rounded-[2.5rem] shadow-2xl p-6 md:p-8 space-y-6 border-8 border-white flex-1 min-h-0 flex flex-col overflow-y-auto"
            >
               <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <h2 className="text-3xl font-bold text-amber-500">Fase 3: Raízes Irracionais</h2>
                  <p className="text-slate-500 font-medium">Estime entre quais medidas o lado está localizado.</p>
                </div>
                <div className="bg-slate-50 px-4 py-2 rounded-2xl font-bold text-slate-600 border border-slate-100">
                  {currentQuestion + 1} / {level2Questions.length}
                </div>
              </div>

              <div className="bg-slate-100/50 p-6 md:p-8 rounded-[2.5rem] border-2 border-dashed border-slate-200">
                <div className="flex flex-col items-center gap-12">
                  
                  {/* Central Square visualization */}
                  <div className="flex flex-col items-center gap-8 w-full pt-4">
                    <div className="relative">
                      <motion.div 
                        animate={{ scale: [1, 1.03, 1] }}
                        transition={{ duration: 2, repeat: Infinity }}
                        className="bg-amber-500 rounded-xl border-8 border-white shadow-2xl shadow-amber-500/20 flex items-center justify-center text-white font-black"
                        style={{ 
                          width: Math.min(Math.sqrt(level2Questions[currentQuestion].area) * 25, 200), 
                          height: Math.min(Math.sqrt(level2Questions[currentQuestion].area) * 25, 200) 
                        }}
                      >
                        <div className="text-center">
                          <div className="text-sm font-bold opacity-70 mb-1 leading-tight">ÁREA</div>
                          <div className="text-4xl">{level2Questions[currentQuestion].area} <span className="text-xl">m²</span></div>
                        </div>
                      </motion.div>

                      <RulerPoints length={Math.sqrt(level2Questions[currentQuestion].area)} orientation="horizontal" />
                      <RulerPoints length={Math.sqrt(level2Questions[currentQuestion].area)} orientation="vertical" />
                    </div>

                    <div className="text-center">
                      <h3 className="text-2xl font-black text-slate-700">
                        Entre quais números está o valor de <span className="text-amber-500">√{level2Questions[currentQuestion].area}</span>?
                      </h3>
                    </div>
                  </div>
                  
                  <div className="w-full space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {level2Questions[currentQuestion].options.map((opt, i) => (
                        <motion.button
                          key={opt}
                          whileHover={{ scale: 1.05, y: -4 }}
                          whileTap={{ scale: 0.95 }}
                          onClick={() => handleLevel2Answer(i)}
                          className="py-6 px-4 bg-white border-4 border-slate-50 rounded-[2rem] font-bold text-lg text-slate-700 hover:border-amber-500 hover:text-amber-500 transition-all shadow-xl shadow-slate-200/50"
                        >
                          {opt}
                        </motion.button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-6 bg-amber-50 border-2 border-amber-100 rounded-[2rem] text-amber-800 flex gap-4">
                <div className="p-2 rounded-xl bg-amber-200 h-fit"><AlertCircle className="w-6 h-6" /></div>
                <div>
                  <p className="font-bold mb-1">Dica de Mestre:</p>
                  <p className="text-sm font-medium opacity-80">
                    Procure os quadrados perfeitos antes e depois de {level2Questions[currentQuestion].area}. 
                    Por exemplo: √9 = 3 e √16 = 4. Se a área é 10, a resposta é 'Entre 3 e 4'.
                  </p>
                </div>
              </div>
            </motion.div>
          )}

          {/* --- LEVEL 3: PYTHAGORAS GARDEN --- */}
          {gameState === 'LEVEL3' && (
            <motion.div 
              key="level3"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-white rounded-[2.5rem] shadow-2xl p-6 md:p-8 space-y-6 border-8 border-white flex-1 min-h-0 flex flex-col overflow-y-auto"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="p-4 rounded-3xl bg-emerald-500 text-white shadow-xl shadow-emerald-500/20">
                    <Fence className="w-10 h-10" />
                  </div>
                  <div>
                    <h2 className="text-3xl font-bold">O Jardim de Pitágoras</h2>
                    <p className="text-slate-500 font-medium">Desafio Final: Aplicação na Vida Real</p>
                  </div>
                </div>
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setShowLevel4Help(!showLevel4Help)}
                  className="flex items-center gap-2 bg-indigo-500 text-white px-6 py-3 rounded-2xl font-bold shadow-lg hover:bg-indigo-600 transition-colors"
                >
                  <HelpCircle className="w-5 h-5" />
                  Como calcular?
                </motion.button>
              </div>

              <AnimatePresence>
                {showLevel4Help && (
                  <motion.div 
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="bg-indigo-50 border-2 border-indigo-100 p-8 rounded-[2.5rem] space-y-4">
                      <h4 className="font-bold text-indigo-700 text-xl text-center">💡 Passo a Passo do Cálculo:</h4>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-indigo-900/80">
                        <div className="space-y-2 bg-white/50 p-4 rounded-2xl">
                          <p className="font-bold text-indigo-800">1º Encontre o Lado:</p>
                          <p className="text-sm">A área do jardim é {gardenArea}m². O lado é <span className="font-bold">√{gardenArea}</span>.</p>
                          <p className="text-sm italic">Dica: Use a calculadora mística se o número for difícil!</p>
                        </div>
                        <div className="space-y-2 bg-white/50 p-4 rounded-2xl">
                          <p className="font-bold text-indigo-800">2º Calcule o Perímetro:</p>
                          <p className="text-sm">O perímetro é a soma dos 4 lados: <br/><span className="font-bold">4 × Lado</span>.</p>
                        </div>
                        <div className="space-y-2 bg-white/50 p-4 rounded-2xl">
                          <p className="font-bold text-indigo-800">3º Calcule o Custo:</p>
                          <p className="text-sm">Multiplique o perímetro pelo preço do metro: <br/><span className="font-bold">Perímetro × {pricePerMeter}</span>.</p>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
                <div className="lg:col-span-7 space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="p-4 bg-emerald-50 rounded-[2rem] border-2 border-emerald-100">
                      <div className="text-xs font-bold text-emerald-600 mb-1 uppercase tracking-wider">ÁREA DISPONÍVEL</div>
                      <div className="text-2xl font-black text-emerald-800">{gardenArea} m²</div>
                    </div>
                    <div className="p-4 bg-emerald-50 rounded-[2rem] border-2 border-emerald-100">
                      <div className="text-xs font-bold text-emerald-600 mb-1 uppercase tracking-wider">PREÇO DA TELA</div>
                      <div className="text-2xl font-black text-emerald-800">R$ 15,50<span className="text-sm">/m</span></div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-base font-bold text-slate-700 block">1. Calcule o Perímetro (4 × Lado)</label>
                      <p className="text-[10px] font-medium text-slate-400 italic leading-none">Use a calculadora de ajuda se precisar da raiz de {gardenArea}.</p>
                      <div className="relative">
                        <input 
                          type="number" 
                          value={perimInput}
                          onChange={(e) => setPerimInput(e.target.value)}
                          className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-3xl focus:border-emerald-500 focus:bg-white outline-none transition-all font-bold text-lg"
                          placeholder="Perímetro..."
                        />
                        <span className="absolute right-6 top-1/2 -translate-y-1/2 font-bold text-slate-300 text-sm">m</span>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-base font-bold text-slate-700 block">2. Custo Total das Telas (R$)</label>
                      <div className="relative">
                        <div className="absolute left-6 top-1/2 -translate-y-1/2 font-bold text-emerald-500 text-lg">R$</div>
                        <input 
                          type="number" 
                          value={costInput}
                          onChange={(e) => setCostInput(e.target.value)}
                          className="w-full p-4 pl-14 bg-slate-50 border-2 border-slate-100 rounded-3xl focus:border-emerald-500 focus:bg-white outline-none transition-all font-bold text-lg"
                          placeholder="Valor total..."
                        />
                      </div>
                    </div>

                    <motion.button 
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={checkGardenResult}
                      className="w-full py-5 bg-emerald-500 text-white rounded-full font-bold text-lg shadow-2xl shadow-emerald-500/20 hover:bg-emerald-600"
                    >
                      Conferir Orçamento
                    </motion.button>
                  </div>
                </div>

                <div className="lg:col-span-5 bg-slate-50 rounded-[2.5rem] p-6 flex flex-col items-center justify-center gap-6 border-2 border-slate-100">
                   <div className="relative group">
                      <motion.div 
                        animate={{ rotate: [0, 2, 0, -2, 0] }}
                        transition={{ duration: 5, repeat: Infinity }}
                        className="w-48 h-48 bg-white border-8 border-emerald-500 rounded-[1.5rem] shadow-xl flex items-center justify-center relative p-4"
                      >
                        <div className="text-center">
                          <div className="text-xs font-bold text-slate-300 mb-1">JARDIM</div>
                          <div className="text-4xl font-black text-emerald-600">{gardenArea}m²</div>
                        </div>
                        {/* Fence visualization */}
                        <div className="absolute -inset-4 border-4 border-dotted border-emerald-300 rounded-[2.5rem] animate-pulse" />
                      </motion.div>
                   </div>
                   <div className="text-center space-y-2">
                      <p className="font-bold text-slate-600 text-lg">Visualização do Projeto</p>
                      <p className="text-sm text-slate-400 font-medium">As áreas em volta serão gramadas.</p>
                   </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* --- FINISH SCREEN --- */}
          {gameState === 'FINISH' && (
            <motion.div 
              key="finish"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              className="space-y-6 flex-1 min-h-0 flex flex-col overflow-y-auto"
            >
              <div className="bg-canva-purple rounded-[2.5rem] shadow-2xl p-6 md:p-10 text-center text-white space-y-6 border-8 border-white/10 shrink-0">
                <div className="relative inline-block">
                  <motion.div 
                    animate={{ scale: [1, 1.2, 1], rotate: 360 }}
                    transition={{ duration: 3, repeat: Infinity }}
                    className="absolute -inset-8 bg-white/20 rounded-full blur-2xl"
                  />
                  <div className="relative bg-white text-canva-purple p-6 rounded-full shadow-2xl">
                    <Trophy className="w-16 h-16" />
                  </div>
                </div>

                <div className="space-y-4">
                  <h2 className="text-5xl font-black italic">Parabéns!</h2>
                  <h3 className="text-2xl font-bold opacity-90 uppercase tracking-widest text-canva-yellow">Pontuação: {score}</h3>
                  <p className="text-sm font-medium opacity-80 uppercase tracking-widest">
                    Tempo: {startTime && endTime ? Math.floor((endTime - startTime) / 1000) : 0} segundos
                  </p>
                </div>

                <div className="max-w-md mx-auto space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2 text-left">
                      <label className="text-xs font-bold uppercase opacity-60 ml-2">Nome do Aluno</label>
                      <input 
                        type="text" 
                        placeholder="Seu nome..."
                        value={playerName}
                        onChange={(e) => setPlayerName(e.target.value)}
                        disabled={hasSavedRecord}
                        className="w-full p-4 rounded-2xl bg-white/10 border-2 border-white/20 text-white placeholder:text-white/40 font-bold outline-none focus:bg-white/20 disabled:opacity-50"
                      />
                    </div>
                    <div className="space-y-2 text-left">
                      <label className="text-xs font-bold uppercase opacity-60 ml-2">Turma / Escola</label>
                      <input 
                        type="text" 
                        placeholder="Ex: 901 / Escola X..."
                        value={playerClass}
                        onChange={(e) => setPlayerClass(e.target.value)}
                        disabled={hasSavedRecord}
                        className="w-full p-4 rounded-2xl bg-white/10 border-2 border-white/20 text-white placeholder:text-white/40 font-bold outline-none focus:bg-white/20 disabled:opacity-50"
                      />
                    </div>
                  </div>
                  
                  <button 
                    onClick={saveScore}
                    disabled={!playerName.trim() || !playerClass.trim() || hasSavedRecord}
                    className={`w-full py-4 rounded-2xl font-black uppercase text-sm tracking-wider shadow-xl transition-all ${
                      hasSavedRecord 
                        ? 'bg-emerald-500 text-white cursor-default' 
                        : 'bg-canva-yellow text-slate-900 hover:scale-105 disabled:opacity-50'
                    }`}
                  >
                    {hasSavedRecord ? 'Recorde Salvo! ✓' : 'Salvar no Ranking da Escola'}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="p-6 bg-white rounded-[2.5rem] border-4 border-slate-50 shadow-xl space-y-4">
                  <h4 className="text-xl font-bold flex items-center gap-2">
                    <Trophy className="text-canva-yellow fill-canva-yellow" />
                    Top 5 Destaques da Escola
                  </h4>
                  <div className="space-y-2">
                    {leaderboard.length === 0 ? (
                      <p className="text-slate-400 text-sm italic text-center py-4">Carregando ranking online...</p>
                    ) : (
                      leaderboard.map((entry, i) => (
                        <div key={i} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100">
                          <div className="flex items-center gap-3">
                            <span className={`w-6 h-6 flex items-center justify-center rounded-full text-[10px] font-bold ${i === 0 ? 'bg-canva-yellow' : 'bg-slate-200'}`}>
                              {i + 1}
                            </span>
                            <div className="flex flex-col">
                              <span className="font-bold text-slate-700 leading-none">{entry.name}</span>
                              <div className="flex items-center gap-2 mt-1">
                                <span className="text-[10px] text-slate-400 font-medium uppercase tracking-tight">{entry.turma}</span>
                                {entry.date && <span className="text-[10px] text-slate-300">• {entry.date}</span>}
                              </div>
                            </div>
                          </div>
                          <span className="font-black text-canva-teal">{entry.score} pts</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="p-6 bg-white rounded-[2.5rem] border-4 border-slate-50 shadow-xl space-y-4 flex flex-col justify-center text-center">
                  <div className="p-4 bg-canva-teal/10 rounded-2xl inline-block mx-auto mb-4">
                    <Calculator className="w-10 h-10 text-canva-teal" />
                  </div>
                  <h4 className="font-black text-2xl text-slate-800">Aula Finalizada!</h4>
                  <p className="text-slate-500 font-medium leading-relaxed">
                    Você completou todos os desafios de radiciação. Mostre sua pontuação e o ranking para o seu professor.
                  </p>
                  <button 
                    onClick={() => setGameState('START')}
                    className="mt-4 px-8 py-4 bg-slate-800 text-white rounded-2xl font-bold hover:bg-slate-900 transition-all"
                  >
                    Tentar Superar Recorde
                  </button>
                </div>
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </main>

      {/* Canva-style Bubbles Phase Indicator */}
      <AnimatePresence>
        {feedback && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.8 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.1 } }}
            className={`fixed bottom-12 left-1/2 -translate-x-1/2 px-10 py-5 rounded-full flex items-center gap-4 shadow-[0_20px_50px_rgba(0,0,0,0.3)] z-50 ring-4 ring-white ${
              feedback.type === 'success' ? 'bg-emerald-500 text-white' : 'bg-rose-500 text-white'
            }`}
          >
            {feedback.type === 'success' ? <CheckCircle2 className="w-8 h-8" /> : <AlertCircle className="w-8 h-8" />}
            <span className="font-bold text-xl">{feedback.message}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <footer className="fixed bottom-0 w-full py-6 bg-white/80 backdrop-blur-md text-center text-xs font-bold text-slate-400 border-t border-slate-100 z-40">
        <div className="flex items-center justify-center gap-2">
          <div className="w-2 h-2 rounded-full bg-canva-teal animate-pulse" />
          EMJGV • Lab de Informática Educativa • Itabira/MG
        </div>
      </footer>

      {/* Floating Help Button */}
      {gameState !== 'START' && gameState !== 'FINISH' && (
        <motion.button
          initial={{ opacity: 0, scale: 0.5, x: 50 }}
          animate={{ opacity: 1, scale: 1, x: 0 }}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          onClick={() => setShowCalc(true)}
          className="fixed right-6 bottom-24 z-40 p-4 bg-canva-purple text-white rounded-2xl shadow-2xl shadow-canva-purple/40 flex items-center gap-2 font-bold"
        >
          <Calculator className="w-6 h-6" />
          <span className="hidden md:inline">Calculadora</span>
        </motion.button>
      )}

      {/* Calculator Modal */}
      <AnimatePresence>
        {showCalc && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowCalc(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-[320px] bg-white rounded-[2.5rem] shadow-[0_30px_60px_-12px_rgba(0,0,0,0.5)] overflow-hidden border-8 border-white"
            >
              <div className="bg-slate-900 p-8 text-right">
                <div className="text-white/40 text-xs font-bold mb-1 h-4 uppercase tracking-widest">Resultado</div>
                <div className="text-white text-3xl font-black truncate font-mono">{calcDisplay || '0'}</div>
              </div>
              <div className="p-4 grid grid-cols-4 gap-2 bg-slate-50">
                {[
                  'C', '√', '÷', 'X',
                  '7', '8', '9', '-',
                  '4', '5', '6', '+',
                  '1', '2', '3', '=',
                  '0', '.'
                ].map((btn) => (
                  <button
                    key={btn}
                    onClick={() => calcAction(btn)}
                    className={`py-4 rounded-2xl font-bold text-lg transition-all ${
                      btn === '=' ? 'col-span-1 bg-canva-teal text-white' : 
                      btn === 'C' ? 'bg-rose-500 text-white' :
                      ['÷', 'X', '-', '+', '√'].includes(btn) ? 'bg-indigo-100 text-indigo-600' :
                      btn === '0' ? 'col-span-2 bg-white text-slate-700 shadow-sm' :
                      'bg-white text-slate-700 shadow-sm'
                    }`}
                  >
                    {btn}
                  </button>
                ))}
              </div>
              <button 
                onClick={() => setShowCalc(false)}
                className="w-full py-4 bg-slate-100 text-slate-400 font-bold hover:bg-slate-200 transition-colors"
              >
                Fechar Calculadora
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
