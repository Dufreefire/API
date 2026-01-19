const AIEngine = require('./AIEngine');

const gameEngines = {};

const GAME_CONFIGS = {
  'lc79_hu': {
    id: 'lc79_hu',
    getResult: (item) => item.Ket_qua,
    getSum: (item) => item.Tong,
    getPhien: (item) => item.Phien,
    options: { streakBreakThreshold: 5, patternConfidenceMultiplier: 1.2 }
  },
  'lc79_md5': {
    id: 'lc79_md5',
    getResult: (item) => item.Ket_qua,
    getSum: (item) => item.Tong,
    getPhien: (item) => item.Phien,
    options: { streakBreakThreshold: 6, patternConfidenceMultiplier: 1.15 }
  },
  '789': {
    id: '789',
    getResult: (item) => item.Ket_qua,
    getSum: (item) => item.Tong,
    getPhien: (item) => item.Phien,
    options: { streakBreakThreshold: 5, patternConfidenceMultiplier: 1.25 }
  },
  'sun': {
    id: 'sun',
    getResult: (item) => item.Ket_qua,
    getSum: (item) => item.Tong,
    getPhien: (item) => item.Phien,
    options: { streakBreakThreshold: 6, patternConfidenceMultiplier: 1.2 }
  },
  'hit_hu': {
    id: 'hit_hu',
    getResult: (item) => item.Ket_qua,
    getSum: (item) => item.Tong,
    getPhien: (item) => item.Phien,
    options: { streakBreakThreshold: 5, patternConfidenceMultiplier: 1.3 }
  },
  'hit_md5': {
    id: 'hit_md5',
    getResult: (item) => item.Ket_qua,
    getSum: (item) => item.Tong,
    getPhien: (item) => item.Phien,
    options: { streakBreakThreshold: 6, patternConfidenceMultiplier: 1.2 }
  },
  'b52': {
    id: 'b52',
    getResult: (item) => item.Ket_qua,
    getSum: (item) => item.Tong,
    getPhien: (item) => item.Phien,
    options: { streakBreakThreshold: 5, patternConfidenceMultiplier: 1.25 }
  },
  'betvip': {
    id: 'betvip',
    getResult: (item) => item.Ket_qua,
    getSum: (item) => item.Tong,
    getPhien: (item) => item.Phien,
    options: { streakBreakThreshold: 6, patternConfidenceMultiplier: 1.15 }
  },
  'luck8': {
    id: 'luck8',
    getResult: (item) => item.Ket_qua,
    getSum: (item) => item.Tong,
    getPhien: (item) => item.Phien,
    options: { streakBreakThreshold: 5, patternConfidenceMultiplier: 1.3 }
  },
  'sicbosun': {
    id: 'sicbosun',
    getResult: (item) => {
      if (!item || !item.facesList) return null;
      const [a, b, c] = item.facesList;
      if (a === b && b === c) return 'Bão';
      return item.score >= 11 ? 'Tài' : 'Xỉu';
    },
    getSum: (item) => item?.score || null,
    getPhien: (item) => item?.gameNum,
    options: { streakBreakThreshold: 6, patternConfidenceMultiplier: 1.2 }
  },
  'sicbo789': {
    id: 'sicbo789',
    getResult: (item) => {
      if (!item || !item.facesList) return null;
      const [a, b, c] = item.facesList;
      if (a === b && b === c) return 'Bão';
      return item.score >= 11 ? 'Tài' : 'Xỉu';
    },
    getSum: (item) => item?.score || null,
    getPhien: (item) => item?.gameNum,
    options: { streakBreakThreshold: 5, patternConfidenceMultiplier: 1.25 }
  },
  'sicbob52': {
    id: 'sicbob52',
    getResult: (item) => {
      if (!item || !item.facesList) return null;
      const [a, b, c] = item.facesList;
      if (a === b && b === c) return 'Bão';
      return item.score >= 11 ? 'Tài' : 'Xỉu';
    },
    getSum: (item) => item?.score || null,
    getPhien: (item) => item?.gameNum,
    options: { streakBreakThreshold: 5, patternConfidenceMultiplier: 1.3 }
  },
  'sicbohit': {
    id: 'sicbohit',
    getResult: (item) => {
      if (!item || !item.facesList) return null;
      const [a, b, c] = item.facesList;
      if (a === b && b === c) return 'Bão';
      return item.score >= 11 ? 'Tài' : 'Xỉu';
    },
    getSum: (item) => item?.score || null,
    getPhien: (item) => item?.gameNum,
    options: { streakBreakThreshold: 6, patternConfidenceMultiplier: 1.15 }
  },
  'sum': {
    id: 'sum',
    getResult: (item) => item.Ket_qua,
    getSum: (item) => item.Tong,
    getPhien: (item) => item.Phien,
    options: { streakBreakThreshold: 5, patternConfidenceMultiplier: 1.2 }
  }
};

function getGameEngine(gameId) {
  if (!gameEngines[gameId]) {
    const config = GAME_CONFIGS[gameId];
    if (!config) {
      console.warn(`[GameAIFactory] Unknown game: ${gameId}, using default config`);
      gameEngines[gameId] = new AIEngine(gameId, {});
    } else {
      gameEngines[gameId] = new AIEngine(config.id, config.options);
    }
  }
  return gameEngines[gameId];
}

function getGameConfig(gameId) {
  return GAME_CONFIGS[gameId] || {
    id: gameId,
    getResult: (item) => item.Ket_qua || item.ket_qua,
    getSum: (item) => item.Tong || item.tong || null,
    getPhien: (item) => item.Phien || item.phien || item.id,
    options: {}
  };
}

function generateAIPrediction(gameId, history) {
  const engine = getGameEngine(gameId);
  const config = getGameConfig(gameId);
  
  if (!history || history.length < 5) {
    return {
      prediction: Math.random() < 0.5 ? 'Tài' : 'Xỉu',
      confidence: 50,
      reason: 'Chưa đủ dữ liệu lịch sử',
      patterns: [],
      aiScore: 0,
      isAI: true
    };
  }
  
  const result = engine.generatePrediction(
    history,
    config.getResult,
    config.getSum
  );
  
  return {
    ...result,
    isAI: true,
    gameId
  };
}

function updateGameLearning(gameId, prediction, actual, patterns) {
  const engine = getGameEngine(gameId);
  engine.updateLearning(prediction, actual, patterns);
}

function getGameStats(gameId) {
  const engine = getGameEngine(gameId);
  return engine.getStats();
}

function getAllGameStats() {
  const stats = {};
  Object.keys(GAME_CONFIGS).forEach(gameId => {
    if (gameEngines[gameId]) {
      stats[gameId] = gameEngines[gameId].getStats();
    }
  });
  return stats;
}

function predictSmartVi(prediction, history, getSum) {
  if (!history || history.length < 5) {
    return prediction === 'Tài' ? [12, 13, 14] : [6, 7, 8];
  }
  
  const recentSums = history.slice(0, 10).map(h => getSum(h)).filter(s => s !== null);
  if (recentSums.length < 5) {
    return prediction === 'Tài' ? [12, 13, 14] : [6, 7, 8];
  }
  
  const avgSum = recentSums.reduce((a, b) => a + b, 0) / recentSums.length;
  
  if (prediction === 'Tài') {
    if (avgSum > 13) {
      return [11, 12, 13];
    } else if (avgSum > 12) {
      return [12, 13, 14];
    } else {
      return [13, 14, 15];
    }
  } else {
    if (avgSum < 8) {
      return [7, 8, 9];
    } else if (avgSum < 9) {
      return [6, 7, 8];
    } else {
      return [5, 6, 7];
    }
  }
}

module.exports = {
  getGameEngine,
  getGameConfig,
  generateAIPrediction,
  updateGameLearning,
  getGameStats,
  getAllGameStats,
  predictSmartVi,
  GAME_CONFIGS
};
