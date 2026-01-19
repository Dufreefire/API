const express = require('express');
const router = express.Router();
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const { generateAIPrediction, updateGameLearning, getGameStats } = require('../core/GameAIFactory');

const HISTORY_DIR = path.join(__dirname, '../data/history');
const LEARNING_FILE = path.join(HISTORY_DIR, 'learning_data_sun.json');
const HISTORY_FILE = path.join(HISTORY_DIR, 'prediction_history_sun.json');
const EXTERNAL_HISTORY_FILE = path.join(HISTORY_DIR, 'external_history_sun.json');

if (!fs.existsSync(HISTORY_DIR)) {
  fs.mkdirSync(HISTORY_DIR, { recursive: true });
}

let predictionHistory = { sun: [] };
let externalHistory = [];
const MIN_HISTORY_FOR_PREDICTION = 10;
const MAX_HISTORY = 100;
const AUTO_SAVE_INTERVAL = 30000;
const AUTO_PREDICT_INTERVAL = 3000;
let lastProcessedPhien = { sun: null };

let learningData = {
  sun: {
    predictions: [],
    patternStats: {},
    totalPredictions: 0,
    correctPredictions: 0,
    patternWeights: {},
    lastUpdate: null,
    streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
    adaptiveThresholds: {},
    recentAccuracy: [],
    reversalState: {
      active: false,
      activatedAt: null,
      consecutiveLosses: 0,
      reversalCount: 0,
      lastReversalResult: null
    },
    transitionMatrix: {
      'Tài->Tài': 0, 'Tài->Xỉu': 0,
      'Xỉu->Tài': 0, 'Xỉu->Xỉu': 0
    }
  }
};

const DEFAULT_PATTERN_WEIGHTS = {
  'cau_bet': 1.3, 'cau_dao_11': 1.2, 'cau_22': 1.15, 'cau_33': 1.2,
  'cau_121': 1.1, 'cau_123': 1.1, 'cau_321': 1.1, 'cau_nhay_coc': 1.0,
  'cau_nhip_nghieng': 1.15, 'cau_3van1': 1.2, 'cau_be_cau': 1.25,
  'cau_chu_ky': 1.1, 'distribution': 0.9, 'dice_pattern': 1.0,
  'sum_trend': 1.05, 'edge_cases': 1.1, 'momentum': 1.15,
  'cau_tu_nhien': 0.8, 'dice_trend_line': 1.2, 'break_pattern': 1.3,
  'fibonacci': 1.0, 'resistance_support': 1.15, 'wave': 1.1,
  'golden_ratio': 1.0, 'day_gay': 1.25, 'cau_44': 1.2, 'cau_55': 1.25,
  'cau_212': 1.1, 'cau_1221': 1.15, 'cau_2112': 1.15, 'cau_gap': 1.1,
  'cau_ziczac': 1.2, 'cau_doi': 1.15, 'cau_rong': 1.3, 'smart_bet': 1.2,
  'markov_chain': 1.35, 'moving_avg_drift': 1.2, 'sum_pressure': 1.25,
  'volatility': 1.15, 'sun_hot_cold': 1.3, 'sun_streak_break': 1.35,
  'sun_balance': 1.2, 'sun_momentum_shift': 1.25
};

function initializePatternStats(type) {
  if (!learningData[type]) return;
  if (!learningData[type].patternStats) learningData[type].patternStats = {};
  if (!learningData[type].patternWeights) learningData[type].patternWeights = { ...DEFAULT_PATTERN_WEIGHTS };
  
  Object.keys(DEFAULT_PATTERN_WEIGHTS).forEach(patternId => {
    if (!learningData[type].patternStats[patternId]) {
      learningData[type].patternStats[patternId] = {
        wins: 0, losses: 0, total: 0, recentResults: []
      };
    }
  });
}

function getPatternWeight(type, patternId) {
  if (!learningData[type] || !learningData[type].patternWeights) {
    return DEFAULT_PATTERN_WEIGHTS[patternId] || 1;
  }
  return learningData[type].patternWeights[patternId] || DEFAULT_PATTERN_WEIGHTS[patternId] || 1;
}

function getPatternIdFromName(name) {
  const mapping = {
    'Cầu Bệt': 'cau_bet', 'Cầu Đảo 1-1': 'cau_dao_11', 'Cầu 2-2': 'cau_22',
    'Cầu 3-3': 'cau_33', 'Cầu 4-4': 'cau_44', 'Cầu 5-5': 'cau_55',
    'Cầu 1-2-1': 'cau_121', 'Cầu 1-2-3': 'cau_123', 'Cầu 3-2-1': 'cau_321',
    'Cầu 2-1-2': 'cau_212', 'Cầu 1-2-2-1': 'cau_1221', 'Cầu 2-1-1-2': 'cau_2112',
    'Cầu Nhảy Cóc': 'cau_nhay_coc', 'Cầu Nhịp Nghiêng': 'cau_nhip_nghieng',
    'Cầu 3 Ván 1': 'cau_3van1', 'Cầu Bẻ Cầu': 'cau_be_cau', 'Cầu Chu Kỳ': 'cau_chu_ky',
    'Cầu Gấp': 'cau_gap', 'Cầu Ziczac': 'cau_ziczac', 'Cầu Đôi': 'cau_doi',
    'Cầu Rồng': 'cau_rong', 'Đảo Xu Hướng': 'smart_bet', 'Xu Hướng Cực': 'smart_bet',
    'Phân bố': 'distribution', 'Tổng TB': 'dice_pattern', 'Xu hướng': 'sum_trend',
    'Cực Điểm': 'edge_cases', 'Biến động': 'momentum', 'Cầu Tự Nhiên': 'cau_tu_nhien'
  };
  for (const [key, value] of Object.entries(mapping)) {
    if (name.includes(key)) return value;
  }
  return null;
}

function getAdaptiveConfidenceBoost(type) {
  if (!learningData[type] || !learningData[type].recentAccuracy) return 0;
  const recentAcc = learningData[type].recentAccuracy;
  if (recentAcc.length < 10) return 0;
  const accuracy = recentAcc.reduce((a, b) => a + b, 0) / recentAcc.length;
  if (accuracy > 0.65) return 5;
  if (accuracy > 0.55) return 2;
  if (accuracy < 0.4) return -5;
  if (accuracy < 0.45) return -2;
  return 0;
}

function getSmartPredictionAdjustment(type, prediction, patterns) {
  if (!learningData[type]) return prediction;
  const streakInfo = learningData[type].streakAnalysis;
  if (streakInfo && streakInfo.currentStreak <= -5) {
    return prediction === 'Tài' ? 'Xỉu' : 'Tài';
  }
  
  let taiPatternScore = 0, xiuPatternScore = 0;
  patterns.forEach(p => {
    const patternId = getPatternIdFromName(p.name || p);
    if (patternId && learningData[type].patternStats) {
      const stats = learningData[type].patternStats[patternId];
      if (stats && stats.recentResults && stats.recentResults.length >= 5) {
        const recentAcc = stats.recentResults.reduce((a, b) => a + b, 0) / stats.recentResults.length;
        const weight = getPatternWeight(type, patternId);
        if (p.prediction === 'Tài') taiPatternScore += recentAcc * weight;
        else xiuPatternScore += recentAcc * weight;
      }
    }
  });
  
  if (Math.abs(taiPatternScore - xiuPatternScore) > 0.5) {
    return taiPatternScore > xiuPatternScore ? 'Tài' : 'Xỉu';
  }
  return prediction;
}

function analyzeCauBet(results, type) {
  if (results.length < 3) return { detected: false };
  let streakType = results[0], streakLength = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] === streakType) streakLength++;
    else break;
  }
  if (streakLength >= 3) {
    const weight = getPatternWeight(type, 'cau_bet');
    const shouldBreak = streakLength >= 6;
    return { 
      detected: true, type: streakType, length: streakLength,
      prediction: shouldBreak ? (streakType === 'Tài' ? 'Xỉu' : 'Tài') : streakType,
      confidence: Math.round((shouldBreak ? Math.min(12, streakLength * 2) : Math.min(15, streakLength * 3)) * weight),
      name: `Cầu Bệt ${streakLength} phiên`, patternId: 'cau_bet'
    };
  }
  return { detected: false };
}

function analyzeCauDao11(results, type) {
  if (results.length < 4) return { detected: false };
  let alternatingLength = 1;
  for (let i = 1; i < Math.min(results.length, 10); i++) {
    if (results[i] !== results[i - 1]) alternatingLength++;
    else break;
  }
  if (alternatingLength >= 4) {
    const weight = getPatternWeight(type, 'cau_dao_11');
    return { 
      detected: true, length: alternatingLength,
      prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.round(Math.min(14, alternatingLength * 2 + 4) * weight),
      name: `Cầu Đảo 1-1 (${alternatingLength} phiên)`, patternId: 'cau_dao_11'
    };
  }
  return { detected: false };
}

function analyzeCau22(results, type) {
  if (results.length < 6) return { detected: false };
  let pairCount = 0, i = 0, pattern = [];
  while (i < results.length - 1 && pairCount < 4) {
    if (results[i] === results[i + 1]) { pattern.push(results[i]); pairCount++; i += 2; }
    else break;
  }
  if (pairCount >= 2) {
    let isAlternating = true;
    for (let j = 1; j < pattern.length; j++) {
      if (pattern[j] === pattern[j - 1]) { isAlternating = false; break; }
    }
    if (isAlternating) {
      const lastPairType = pattern[pattern.length - 1];
      const weight = getPatternWeight(type, 'cau_22');
      return { 
        detected: true, pairCount,
        prediction: lastPairType === 'Tài' ? 'Xỉu' : 'Tài',
        confidence: Math.round(Math.min(12, pairCount * 3 + 3) * weight),
        name: `Cầu 2-2 (${pairCount} cặp)`, patternId: 'cau_22'
      };
    }
  }
  return { detected: false };
}

function analyzeCau33(results, type) {
  if (results.length < 6) return { detected: false };
  let tripleCount = 0, i = 0, pattern = [];
  while (i < results.length - 2) {
    if (results[i] === results[i + 1] && results[i + 1] === results[i + 2]) {
      pattern.push(results[i]); tripleCount++; i += 3;
    } else break;
  }
  if (tripleCount >= 1) {
    const currentPosition = results.length % 3;
    const lastTripleType = pattern[pattern.length - 1];
    const weight = getPatternWeight(type, 'cau_33');
    let prediction = currentPosition === 0 ? (lastTripleType === 'Tài' ? 'Xỉu' : 'Tài') : lastTripleType;
    return { 
      detected: true, tripleCount, prediction,
      confidence: Math.round(Math.min(13, tripleCount * 4 + 5) * weight),
      name: `Cầu 3-3 (${tripleCount} bộ ba)`, patternId: 'cau_33'
    };
  }
  return { detected: false };
}

function analyzeCauNhipNghieng(results, type) {
  if (results.length < 5) return { detected: false };
  const last5 = results.slice(0, 5);
  const taiCount5 = last5.filter(r => r === 'Tài').length;
  const weight = getPatternWeight(type, 'cau_nhip_nghieng');
  if (taiCount5 >= 4) {
    return { detected: true, prediction: 'Tài', confidence: Math.round(9 * weight),
      name: `Cầu Nhịp Nghiêng 5 (${taiCount5} Tài)`, patternId: 'cau_nhip_nghieng' };
  } else if (taiCount5 <= 1) {
    return { detected: true, prediction: 'Xỉu', confidence: Math.round(9 * weight),
      name: `Cầu Nhịp Nghiêng 5 (${5 - taiCount5} Xỉu)`, patternId: 'cau_nhip_nghieng' };
  }
  return { detected: false };
}

function analyzeCau3Van1(results, type) {
  if (results.length < 4) return { detected: false };
  const last4 = results.slice(0, 4);
  const taiCount = last4.filter(r => r === 'Tài').length;
  const weight = getPatternWeight(type, 'cau_3van1');
  if (taiCount === 3) {
    return { detected: true, prediction: 'Xỉu', confidence: Math.round(8 * weight),
      name: 'Cầu 3 Ván 1 (3T-1X)', patternId: 'cau_3van1' };
  } else if (taiCount === 1) {
    return { detected: true, prediction: 'Tài', confidence: Math.round(8 * weight),
      name: 'Cầu 3 Ván 1 (3X-1T)', patternId: 'cau_3van1' };
  }
  return { detected: false };
}

function analyzeCauBeCau(results, type) {
  if (results.length < 8) return { detected: false };
  const recentStreak = analyzeCauBet(results, type);
  if (recentStreak.detected && recentStreak.length >= 4) {
    const beforeStreak = results.slice(recentStreak.length, recentStreak.length + 4);
    const previousPattern = analyzeCauBet(beforeStreak, type);
    if (previousPattern.detected && previousPattern.type !== recentStreak.type) {
      const weight = getPatternWeight(type, 'cau_be_cau');
      return { detected: true, prediction: recentStreak.type === 'Tài' ? 'Xỉu' : 'Tài',
        confidence: Math.round(11 * weight), name: 'Cầu Bẻ Cầu', patternId: 'cau_be_cau' };
    }
  }
  return { detected: false };
}

function analyzeCauRong(results, type) {
  if (results.length < 6) return { detected: false };
  const weight = getPatternWeight(type, 'cau_rong');
  let streakLength = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] === results[0]) streakLength++;
    else break;
  }
  if (streakLength >= 6) {
    return { detected: true, streakLength,
      prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.round(Math.min(16, streakLength + 8) * weight),
      name: `Cầu Rồng ${streakLength} phiên (Bẻ mạnh)`, patternId: 'cau_rong' };
  }
  return { detected: false };
}

function analyzeSmartBet(results, type) {
  if (results.length < 10) return { detected: false };
  const weight = getPatternWeight(type, 'smart_bet');
  const last10 = results.slice(0, 10);
  const last5 = results.slice(0, 5);
  const prev5 = results.slice(5, 10);
  const taiLast5 = last5.filter(r => r === 'Tài').length;
  const taiPrev5 = prev5.filter(r => r === 'Tài').length;
  const trendChanging = (taiLast5 >= 4 && taiPrev5 <= 1) || (taiLast5 <= 1 && taiPrev5 >= 4);
  if (trendChanging) {
    const currentDominant = taiLast5 >= 4 ? 'Tài' : 'Xỉu';
    return { detected: true, prediction: currentDominant === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.round(13 * weight), name: `Đảo Xu Hướng (${taiLast5}T-${5-taiLast5}X)`, patternId: 'smart_bet' };
  }
  const taiLast10 = last10.filter(r => r === 'Tài').length;
  if (taiLast10 >= 8 || taiLast10 <= 2) {
    const dominant = taiLast10 >= 8 ? 'Tài' : 'Xỉu';
    return { detected: true, prediction: dominant === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.round(12 * weight), name: `Xu Hướng Cực (${taiLast10}T-${10-taiLast10}X)`, patternId: 'smart_bet' };
  }
  return { detected: false };
}

function analyzeDistribution(data, type, windowSize = 50) {
  const window = data.slice(0, windowSize);
  const taiCount = window.filter(d => d.Ket_qua === 'Tài').length;
  const xiuCount = window.length - taiCount;
  return {
    taiPercent: (taiCount / window.length) * 100,
    xiuPercent: (xiuCount / window.length) * 100,
    taiCount, xiuCount, total: window.length,
    imbalance: Math.abs(taiCount - xiuCount) / window.length
  };
}

function analyzeDicePatterns(data) {
  const recentData = data.slice(0, 15);
  let totalSum = 0;
  recentData.forEach(d => { totalSum += d.Tong; });
  const avgSum = totalSum / recentData.length;
  return { averageSum: avgSum, sumTrend: avgSum > 10.5 ? 'high' : 'low' };
}

function analyzeSumTrend(data) {
  const recentSums = data.slice(0, 20).map(d => d.Tong);
  let increasingCount = 0, decreasingCount = 0;
  for (let i = 0; i < recentSums.length - 1; i++) {
    if (recentSums[i] > recentSums[i + 1]) decreasingCount++;
    else if (recentSums[i] < recentSums[i + 1]) increasingCount++;
  }
  const movingAvg5 = recentSums.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
  return {
    trend: increasingCount > decreasingCount ? 'increasing' : 'decreasing',
    strength: Math.abs(increasingCount - decreasingCount) / (recentSums.length - 1),
    movingAvg5, shortTermBias: movingAvg5 > 10.5 ? 'Tài' : 'Xỉu'
  };
}

function analyzeEdgeCases(data, type) {
  if (data.length < 10) return { detected: false };
  const recentTotals = data.slice(0, 10).map(d => d.Tong);
  const extremeHighCount = recentTotals.filter(t => t >= 14).length;
  const extremeLowCount = recentTotals.filter(t => t <= 7).length;
  const weight = getPatternWeight(type, 'edge_cases');
  if (extremeHighCount >= 4) {
    return { detected: true, prediction: 'Xỉu', confidence: Math.round(7 * weight),
      name: `Cực Điểm Cao (${extremeHighCount} phiên >= 14)`, patternId: 'edge_cases' };
  }
  if (extremeLowCount >= 4) {
    return { detected: true, prediction: 'Tài', confidence: Math.round(7 * weight),
      name: `Cực Điểm Thấp (${extremeLowCount} phiên <= 7)`, patternId: 'edge_cases' };
  }
  return { detected: false };
}

function detectCyclePattern(results, type) {
  if (results.length < 12) return { detected: false };
  for (let cycleLength = 2; cycleLength <= 6; cycleLength++) {
    let isRepeating = true;
    const pattern = results.slice(0, cycleLength);
    for (let i = cycleLength; i < Math.min(cycleLength * 3, results.length); i++) {
      if (results[i] !== pattern[i % cycleLength]) { isRepeating = false; break; }
    }
    if (isRepeating) {
      const nextPosition = results.length % cycleLength;
      const weight = getPatternWeight(type, 'cau_chu_ky');
      return { detected: true, cycleLength, prediction: pattern[nextPosition],
        confidence: Math.round(9 * weight), name: `Cầu Chu Kỳ ${cycleLength}`, patternId: 'cau_chu_ky' };
    }
  }
  return { detected: false };
}

function analyzeCauZiczac(results, type) {
  if (results.length < 8) return { detected: false };
  const weight = getPatternWeight(type, 'cau_ziczac');
  let zigzagCount = 0;
  for (let i = 0; i < results.length - 2; i++) {
    if (results[i] !== results[i + 1] && results[i + 1] !== results[i + 2] && results[i] === results[i + 2]) {
      zigzagCount++;
    } else break;
  }
  if (zigzagCount >= 3) {
    return { detected: true, prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.round(Math.min(13, zigzagCount * 2 + 5) * weight),
      name: `Cầu Ziczac (${zigzagCount} lần)`, patternId: 'cau_ziczac' };
  }
  return { detected: false };
}

function analyzeCauTuNhien(results, type) {
  if (results.length < 2) return { detected: false };
  const weight = getPatternWeight(type, 'cau_tu_nhien');
  return { detected: true, prediction: results[0], confidence: Math.round(5 * weight),
    name: 'Cầu Tự Nhiên (Theo Ván Trước)', patternId: 'cau_tu_nhien' };
}

const WEBSOCKET_URL = "wss://websocket.azhkthg1.net/websocket?token=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJhbW91bnQiOjAsInVzZXJuYW1lIjoiU0NfYXBpc3Vud2luMTIzIn0.hgrRbSV6vnBwJMg9ZFtbx3rRu9mX_hZMZ_m5gMNhkw0";
const WS_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  "Origin": "https://play.sun.win"
};

const initialMessages = [
  [
    1, "MiniGame", "GM_fbbdbebndbbc", "123123p",
    {
      "info": "{\"ipAddress\":\"2402:800:62cd:cb7c:1a7:7a52:9c3e:c290\",\"wsToken\":\"eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJnZW5kZXIiOjAsImNhblZpZXdTdGF0IjpmYWxzZSwiZGlzcGxheU5hbWUiOiJuZG5lYmViYnMiLCJib3QiOjAsImlzTWVyY2hhbnQiOmZhbHNlLCJ2ZXJpZmllZEJhbmtBY2NvdW50IjpmYWxzZSwicGxheUV2ZW50TG9iYnkiOmZhbHNlLCJjdXN0b21lcklkIjozMTIxMDczMTUsImFmZklkIjoiR0VNV0lOIiwiYmFubmVkIjpmYWxzZSwiYnJhbmQiOiJnZW0iLCJ0aW1lc3RhbXAiOjE3NTQ5MjYxMDI1MjcsImxvY2tHYW1lcyI6W10sImFtb3VudCI6MCwibG9ja0NoYXQiOmZhbHNlLCJwaG9uZVZlcmlmaWVkIjpmYWxzZSwiaXBBZGRyZXNzIjoiMjQwMjo4MDA6NjJjZDpjYjdjOjFhNzo3YTUyOjljM2U6YzI5MCIsIm11dGUiOmZhbHNlLCJhdmF0YXIiOiJodHRwczovL2ltYWdlcy5zd2luc2hvcC5uZXQvaW1hZ2VzL2F2YXRhci9hdmF0YXJfMDEucG5nIiwicGxhdGZvcm1JZCI6NSwidXNlcklkIjoiN2RhNDlhNDQtMjlhYS00ZmRiLWJkNGMtNjU5OTQ5YzU3NDdkIiwicmVnVGltZSI6MTc1NDkyNjAyMjUxNSwicGhvbmUiOiIiLCJkZXBvc2l0IjpmYWxzZSwidXNlcm5hbWUiOiJHTV9mYmJkYmVibmRiYmMifQ.DAyEeoAnz8we-Qd0xS0tnqOZ8idkUJkxksBjr_Gei8A\",\"locale\":\"vi\",\"userId\":\"7da49a44-29aa-4fdb-bd4c-659949c5747d\",\"username\":\"GM_fbbdbebndbbc\",\"timestamp\":1754926102527,\"refreshToken\":\"7cc4ad191f4348849f69427a366ea0fd.a68ece9aa85842c7ba523170d0a4ae3e\"}",
      "signature": "53D9E12F910044B140A2EC659167512E2329502FE84A6744F1CD5CBA9B6EC04915673F2CBAE043C4EDB94DDF88F3D3E839A931100845B8F179106E1F44ECBB4253EC536610CCBD0CE90BD8495DAC3E8A9DBDB46FE49B51E88569A6F117F8336AC7ADC226B4F213ECE2F8E0996F2DD5515476C8275F0B2406CDF2987F38A6DA24"
    }
  ],
  [6, "MiniGame", "taixiuPlugin", { cmd: 1005 }],
  [6, "MiniGame", "lobbyPlugin", { cmd: 10001 }]
];

let ws = null;
let pingInterval = null;
let reconnectTimeout = null;
let currentSessionId = null;
let wsConnected = false;

function loadExternalHistory() {
  try {
    if (fs.existsSync(EXTERNAL_HISTORY_FILE)) {
      const data = fs.readFileSync(EXTERNAL_HISTORY_FILE, 'utf8');
      externalHistory = JSON.parse(data);
      console.log(`[Sun] External history loaded: ${externalHistory.length} records`);
    }
  } catch (error) {
    console.error('[Sun] Error loading external history:', error.message);
    externalHistory = [];
  }
}

function saveExternalHistory() {
  try {
    fs.writeFileSync(EXTERNAL_HISTORY_FILE, JSON.stringify(externalHistory, null, 2));
  } catch (error) {
    console.error('[Sun] Error saving external history:', error.message);
  }
}

function loadLearningData() {
  try {
    if (fs.existsSync(LEARNING_FILE)) {
      const data = fs.readFileSync(LEARNING_FILE, 'utf8');
      const parsed = JSON.parse(data);
      if (parsed.sun) {
        learningData = { ...learningData, ...parsed };
      }
      console.log('[Sun] Learning data loaded successfully');
    }
  } catch (error) {
    console.error('[Sun] Error loading learning data:', error.message);
  }
}

function saveLearningData() {
  try {
    fs.writeFileSync(LEARNING_FILE, JSON.stringify(learningData, null, 2));
  } catch (error) {
    console.error('[Sun] Error saving learning data:', error.message);
  }
}

function loadPredictionHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const data = fs.readFileSync(HISTORY_FILE, 'utf8');
      const parsed = JSON.parse(data);
      predictionHistory = parsed.history || { sun: [] };
      lastProcessedPhien = parsed.lastProcessedPhien || { sun: null };
      console.log('[Sun] Prediction history loaded successfully');
      console.log(`  - Sun: ${predictionHistory.sun?.length || 0} records`);
    }
  } catch (error) {
    console.error('[Sun] Error loading prediction history:', error.message);
  }
}

function savePredictionHistory() {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify({
      history: predictionHistory,
      lastProcessedPhien
    }, null, 2));
  } catch (error) {
    console.error('[Sun] Error saving prediction history:', error.message);
  }
}

function startAutoSaveTask() {
  setInterval(() => {
    saveLearningData();
    savePredictionHistory();
    saveExternalHistory();
  }, AUTO_SAVE_INTERVAL);
  console.log('[Sun] Auto-save task started (every 30s)');
}

async function autoPrediction() {
  try {
    if (externalHistory.length < MIN_HISTORY_FOR_PREDICTION) return;
    
    const gameData = externalHistory;
    const latestPhien = gameData[0].Phien;
    const nextPhien = typeof latestPhien === 'number' ? latestPhien + 1 : parseInt(latestPhien) + 1;
    
    if (lastProcessedPhien.sun !== nextPhien) {
      await verifyPredictions('sun', gameData);
      
      const result = calculateAdvancedPrediction(gameData, 'sun');
      savePredictionToHistory('sun', nextPhien, result.prediction, result.confidence);
      recordPrediction('sun', nextPhien, result.prediction, result.confidence, result.factors);
      
      lastProcessedPhien.sun = nextPhien;
      console.log(`[Sun-Auto] Phien ${nextPhien}: ${result.prediction} (${result.confidence}%)`);
    }
  } catch (error) {
    console.error('[Sun-Auto] Error:', error.message);
  }
}

function startAutoPrediction() {
  setInterval(autoPrediction, AUTO_PREDICT_INTERVAL);
  console.log('[Sun] Auto-prediction started (every 3s)');
}

function connectWebSocket() {
  if (ws) {
    ws.removeAllListeners();
    try { ws.close(); } catch (e) {}
  }

  console.log('[Sun] Connecting to WebSocket...');
  
  try {
    ws = new WebSocket(WEBSOCKET_URL, { headers: WS_HEADERS });

    ws.on('open', () => {
      console.log('[Sun] ✅ WebSocket connected');
      wsConnected = true;
      
      initialMessages.forEach((msg, i) => {
        setTimeout(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(msg));
          }
        }, i * 600);
      });

      clearInterval(pingInterval);
      pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.ping();
        }
      }, 15000);
    });

    ws.on('pong', () => {});

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());

        if (!Array.isArray(data) || typeof data[1] !== 'object') return;

        const { cmd, sid, d1, d2, d3, gBB } = data[1];

        if (cmd === 1008 && sid) {
          currentSessionId = sid;
        }

        if (cmd === 1003 && gBB) {
          if (!d1 || !d2 || !d3) return;

          const total = d1 + d2 + d3;
          const ketqua = total > 10 ? "Tài" : "Xỉu";

          const result = {
            Phien: currentSessionId,
            Xuc_xac_1: d1,
            Xuc_xac_2: d2,
            Xuc_xac_3: d3,
            Tong: total,
            Ket_qua: ketqua,
            timestamp: Date.now()
          };

          const exists = externalHistory.find(h => h.Phien === currentSessionId);
          if (!exists && currentSessionId) {
            externalHistory.unshift(result);
            if (externalHistory.length > MAX_HISTORY) {
              externalHistory = externalHistory.slice(0, MAX_HISTORY);
            }
            console.log(`[Sun] 🎲 Phiên ${currentSessionId}: ${d1}-${d2}-${d3} = ${total} (${ketqua})`);
            saveExternalHistory();
          }
        }
      } catch (e) {}
    });

    ws.on('close', () => {
      console.log('[Sun] 🔌 WebSocket closed. Reconnecting in 5s...');
      wsConnected = false;
      clearInterval(pingInterval);
      reconnectTimeout = setTimeout(connectWebSocket, 5000);
    });

    ws.on('error', (error) => {
      console.error('[Sun] ❌ WebSocket error:', error.message);
      wsConnected = false;
    });

  } catch (error) {
    console.error('[Sun] Failed to connect WebSocket:', error.message);
    reconnectTimeout = setTimeout(connectWebSocket, 5000);
  }
}

function normalizeResult(result) {
  if (!result) return 'Tài';
  const lower = result.toString().toLowerCase();
  if (lower.includes('tai') || lower.includes('tài') || lower === 't') return 'Tài';
  if (lower.includes('xiu') || lower.includes('xỉu') || lower === 'x') return 'Xỉu';
  return result;
}

function fetchData() {
  if (externalHistory.length === 0) return null;
  return { data: externalHistory };
}

function calculateAdvancedPrediction(data, type) {
  if (!data || data.length < MIN_HISTORY_FOR_PREDICTION) {
    return { prediction: 'Tài', confidence: 50, factors: {} };
  }

  const last50 = data.slice(0, 50);
  const results = last50.map(d => normalizeResult(d.Ket_qua));
  
  initializePatternStats(type);
  
  let predictions = [];
  let factors = [];
  let allPatterns = [];
  
  const cauBet = analyzeCauBet(results, type);
  if (cauBet.detected) {
    predictions.push({ prediction: cauBet.prediction, confidence: cauBet.confidence, priority: 10, name: cauBet.name });
    factors.push(cauBet.name);
    allPatterns.push(cauBet);
  }
  
  const cauDao11 = analyzeCauDao11(results, type);
  if (cauDao11.detected) {
    predictions.push({ prediction: cauDao11.prediction, confidence: cauDao11.confidence, priority: 9, name: cauDao11.name });
    factors.push(cauDao11.name);
    allPatterns.push(cauDao11);
  }
  
  const cau22 = analyzeCau22(results, type);
  if (cau22.detected) {
    predictions.push({ prediction: cau22.prediction, confidence: cau22.confidence, priority: 8, name: cau22.name });
    factors.push(cau22.name);
    allPatterns.push(cau22);
  }
  
  const cau33 = analyzeCau33(results, type);
  if (cau33.detected) {
    predictions.push({ prediction: cau33.prediction, confidence: cau33.confidence, priority: 8, name: cau33.name });
    factors.push(cau33.name);
    allPatterns.push(cau33);
  }
  
  const cauNhipNghieng = analyzeCauNhipNghieng(results, type);
  if (cauNhipNghieng.detected) {
    predictions.push({ prediction: cauNhipNghieng.prediction, confidence: cauNhipNghieng.confidence, priority: 7, name: cauNhipNghieng.name });
    factors.push(cauNhipNghieng.name);
    allPatterns.push(cauNhipNghieng);
  }
  
  const cau3Van1 = analyzeCau3Van1(results, type);
  if (cau3Van1.detected) {
    predictions.push({ prediction: cau3Van1.prediction, confidence: cau3Van1.confidence, priority: 6, name: cau3Van1.name });
    factors.push(cau3Van1.name);
    allPatterns.push(cau3Van1);
  }
  
  const cauBeCau = analyzeCauBeCau(results, type);
  if (cauBeCau.detected) {
    predictions.push({ prediction: cauBeCau.prediction, confidence: cauBeCau.confidence, priority: 8, name: cauBeCau.name });
    factors.push(cauBeCau.name);
    allPatterns.push(cauBeCau);
  }
  
  const cauRong = analyzeCauRong(results, type);
  if (cauRong.detected) {
    predictions.push({ prediction: cauRong.prediction, confidence: cauRong.confidence, priority: 10, name: cauRong.name });
    factors.push(cauRong.name);
    allPatterns.push(cauRong);
  }
  
  const smartBet = analyzeSmartBet(results, type);
  if (smartBet.detected) {
    predictions.push({ prediction: smartBet.prediction, confidence: smartBet.confidence, priority: 9, name: smartBet.name });
    factors.push(smartBet.name);
    allPatterns.push(smartBet);
  }
  
  const cyclePattern = detectCyclePattern(results, type);
  if (cyclePattern.detected) {
    predictions.push({ prediction: cyclePattern.prediction, confidence: cyclePattern.confidence, priority: 7, name: cyclePattern.name });
    factors.push(cyclePattern.name);
    allPatterns.push(cyclePattern);
  }
  
  const cauZiczac = analyzeCauZiczac(results, type);
  if (cauZiczac.detected) {
    predictions.push({ prediction: cauZiczac.prediction, confidence: cauZiczac.confidence, priority: 8, name: cauZiczac.name });
    factors.push(cauZiczac.name);
    allPatterns.push(cauZiczac);
  }
  
  const distribution = analyzeDistribution(last50, type);
  if (distribution.imbalance > 0.2) {
    const minority = distribution.taiPercent < 50 ? 'Tài' : 'Xỉu';
    const weight = getPatternWeight(type, 'distribution');
    predictions.push({ prediction: minority, confidence: Math.round(6 * weight), priority: 5, name: 'Phân bố lệch' });
    factors.push(`Phân bố lệch (T:${distribution.taiPercent.toFixed(0)}% - X:${distribution.xiuPercent.toFixed(0)}%)`);
  }
  
  const dicePatterns = analyzeDicePatterns(last50);
  if (dicePatterns.averageSum > 11.5) {
    const weight = getPatternWeight(type, 'dice_pattern');
    predictions.push({ prediction: 'Xỉu', confidence: Math.round(5 * weight), priority: 4, name: 'Tổng TB cao' });
    factors.push(`Tổng TB cao (${dicePatterns.averageSum.toFixed(1)})`);
  } else if (dicePatterns.averageSum < 9.5) {
    const weight = getPatternWeight(type, 'dice_pattern');
    predictions.push({ prediction: 'Tài', confidence: Math.round(5 * weight), priority: 4, name: 'Tổng TB thấp' });
    factors.push(`Tổng TB thấp (${dicePatterns.averageSum.toFixed(1)})`);
  }
  
  const sumTrendAnalysis = analyzeSumTrend(last50);
  if (sumTrendAnalysis.strength > 0.4) {
    const trendPrediction = sumTrendAnalysis.trend === 'increasing' ? 'Tài' : 'Xỉu';
    const weight = getPatternWeight(type, 'sum_trend');
    predictions.push({ prediction: trendPrediction, confidence: Math.round(4 * weight), priority: 3, name: 'Xu hướng tổng' });
    factors.push(`Xu hướng tổng ${sumTrendAnalysis.trend === 'increasing' ? 'tăng' : 'giảm'}`);
  }
  
  const edgeCases = analyzeEdgeCases(last50, type);
  if (edgeCases.detected) {
    predictions.push({ prediction: edgeCases.prediction, confidence: edgeCases.confidence, priority: 5, name: edgeCases.name });
    factors.push(edgeCases.name);
    allPatterns.push(edgeCases);
  }
  
  if (predictions.length === 0) {
    const cauTuNhien = analyzeCauTuNhien(results, type);
    predictions.push({ prediction: cauTuNhien.prediction, confidence: cauTuNhien.confidence, priority: 1, name: cauTuNhien.name });
    factors.push(cauTuNhien.name);
    allPatterns.push(cauTuNhien);
  }
  
  const aiResult = generateAIPrediction('sun', last50);
  if (aiResult && aiResult.patterns && aiResult.patterns.length > 0) {
    aiResult.patterns.forEach(aiPattern => {
      predictions.push({
        prediction: aiPattern.prediction,
        confidence: parseFloat(aiPattern.confidence) || 15,
        priority: 14,
        name: `AI: ${aiPattern.name}`
      });
      factors.push(`AI: ${aiPattern.name}`);
    });
    
    predictions.push({
      prediction: aiResult.prediction,
      confidence: aiResult.confidence * 0.4,
      priority: 15,
      name: `AI Engine (${aiResult.aiScore}%)`
    });
    factors.push(`AI Engine: ${aiResult.reason}`);
  }
  
  predictions.sort((a, b) => b.priority - a.priority || b.confidence - a.confidence);
  
  const taiVotes = predictions.filter(p => p.prediction === 'Tài');
  const xiuVotes = predictions.filter(p => p.prediction === 'Xỉu');
  
  const taiScore = taiVotes.reduce((sum, p) => sum + p.confidence * p.priority, 0);
  const xiuScore = xiuVotes.reduce((sum, p) => sum + p.confidence * p.priority, 0);
  
  let finalPrediction = taiScore >= xiuScore ? 'Tài' : 'Xỉu';
  
  finalPrediction = getSmartPredictionAdjustment(type, finalPrediction, allPatterns);
  
  let baseConfidence = 50;
  
  const topPredictions = predictions.slice(0, 3);
  topPredictions.forEach(p => {
    if (p.prediction === finalPrediction) {
      baseConfidence += p.confidence;
    }
  });
  
  const agreementRatio = (finalPrediction === 'Tài' ? taiVotes.length : xiuVotes.length) / Math.max(predictions.length, 1);
  baseConfidence += Math.round(agreementRatio * 10);
  
  const adaptiveBoost = getAdaptiveConfidenceBoost(type);
  baseConfidence += adaptiveBoost;
  
  const randomAdjust = (Math.random() * 4) - 2;
  let finalConfidence = Math.round(baseConfidence + randomAdjust);
  
  finalConfidence = Math.max(50, Math.min(85, finalConfidence));
  
  return {
    prediction: finalPrediction,
    confidence: finalConfidence,
    factors,
    allPatterns,
    detailedAnalysis: {
      totalPatterns: predictions.length,
      taiVotes: taiVotes.length,
      xiuVotes: xiuVotes.length,
      taiScore,
      xiuScore,
      topPattern: predictions[0]?.name || 'N/A',
      distribution,
      dicePatterns,
      sumTrend: sumTrendAnalysis,
      adaptiveBoost,
      learningStats: {
        totalPredictions: learningData[type]?.totalPredictions || 0,
        correctPredictions: learningData[type]?.correctPredictions || 0,
        accuracy: learningData[type]?.totalPredictions > 0 
          ? (learningData[type].correctPredictions / learningData[type].totalPredictions * 100).toFixed(1) + '%'
          : 'N/A',
        currentStreak: learningData[type]?.streakAnalysis?.currentStreak || 0
      }
    }
  };
}

function savePredictionToHistory(type, phien, prediction, confidence) {
  const record = {
    phien: phien.toString(),
    du_doan: normalizeResult(prediction),
    ti_le: `${confidence}%`,
    id: '@mryanhdz',
    timestamp: new Date().toISOString()
  };
  
  if (!predictionHistory[type]) predictionHistory[type] = [];
  predictionHistory[type].unshift(record);
  
  if (predictionHistory[type].length > MAX_HISTORY) {
    predictionHistory[type] = predictionHistory[type].slice(0, MAX_HISTORY);
  }
  
  return record;
}

function recordPrediction(type, phien, prediction, confidence, factors) {
  if (!learningData[type]) return;
  
  learningData[type].predictions.unshift({
    phien: phien.toString(),
    prediction: normalizeResult(prediction),
    confidence,
    factors,
    timestamp: Date.now(),
    verified: false
  });

  if (learningData[type].predictions.length > MAX_HISTORY) {
    learningData[type].predictions = learningData[type].predictions.slice(0, MAX_HISTORY);
  }
}

async function verifyPredictions(type, currentData) {
  if (!learningData[type] || !currentData || currentData.length === 0) return;

  const unverified = learningData[type].predictions.filter(p => !p.verified);
  
  let latestPhien = 0;
  currentData.forEach(d => {
    const phien = parseInt(d.Phien);
    if (phien > latestPhien) latestPhien = phien;
  });
  
  for (const pred of unverified) {
    const actual = currentData.find(d => d.Phien?.toString() === pred.phien);
    if (actual) {
      const actualResult = normalizeResult(actual.Ket_qua);
      pred.verified = true;
      pred.actual = actualResult;
      pred.isCorrect = pred.prediction === actualResult;

      if (pred.isCorrect) {
        learningData[type].correctPredictions++;
        learningData[type].streakAnalysis.wins++;
        learningData[type].streakAnalysis.currentStreak = 
          learningData[type].streakAnalysis.currentStreak >= 0 
            ? learningData[type].streakAnalysis.currentStreak + 1 
            : 1;
      } else {
        learningData[type].streakAnalysis.losses++;
        learningData[type].streakAnalysis.currentStreak = 
          learningData[type].streakAnalysis.currentStreak <= 0 
            ? learningData[type].streakAnalysis.currentStreak - 1 
            : -1;
      }

      learningData[type].totalPredictions++;
      learningData[type].lastUpdate = new Date().toISOString();
    }
  }
  
  const oldLength = learningData[type].predictions.length;
  learningData[type].predictions = learningData[type].predictions.filter(p => {
    if (p.verified) return true;
    const phienNum = parseInt(p.phien);
    if (latestPhien - phienNum > 150) return false;
    return true;
  });
  
  if (learningData[type].predictions.length !== oldLength) {
    console.log(`[Sun-${type}] Cleaned ${oldLength - learningData[type].predictions.length} old unverified predictions`);
  }
}

router.get('/', (req, res) => {
  res.json({
    message: 'API Sun - Tài Xỉu Prediction',
    wsConnected,
    historyCount: externalHistory.length,
    canPredict: externalHistory.length >= MIN_HISTORY_FOR_PREDICTION
  });
});

router.get('/taixiu', async (req, res) => {
  try {
    if (externalHistory.length < MIN_HISTORY_FOR_PREDICTION) {
      return res.json({
        error: `Cần ít nhất ${MIN_HISTORY_FOR_PREDICTION} lịch sử để dự đoán`,
        current: externalHistory.length,
        required: MIN_HISTORY_FOR_PREDICTION,
        wsConnected,
        message: 'Đang chờ dữ liệu từ WebSocket...'
      });
    }
    
    const data = fetchData();
    if (!data || !data.data || data.data.length === 0) {
      return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
    }
    
    await verifyPredictions('sun', data.data);
    
    const gameData = data.data;
    const latestPhien = gameData[0].Phien;
    const nextPhien = typeof latestPhien === 'number' ? latestPhien + 1 : parseInt(latestPhien) + 1;
    
    const result = calculateAdvancedPrediction(gameData, 'sun');
    
    savePredictionToHistory('sun', nextPhien, result.prediction, result.confidence);
    recordPrediction('sun', nextPhien, result.prediction, result.confidence, result.factors);
    
    res.json({
      phien: nextPhien.toString(),
      du_doan: normalizeResult(result.prediction),
      ti_le: `${result.confidence}%`,
      id: '@mryanhdz'
    });
  } catch (error) {
    console.error('[Sun] Error:', error);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

router.get('/taixiu/lichsu', async (req, res) => {
  res.json({
    type: 'Sun Tài Xỉu',
    history: externalHistory.slice(0, 20),
    total: externalHistory.length,
    wsConnected
  });
});

router.get('/stats', (req, res) => {
  const stats = learningData.sun;
  res.json({
    totalPredictions: stats.totalPredictions,
    correctPredictions: stats.correctPredictions,
    accuracy: stats.totalPredictions > 0 
      ? (stats.correctPredictions / stats.totalPredictions * 100).toFixed(2) + '%'
      : 'N/A',
    streakAnalysis: stats.streakAnalysis,
    wsConnected,
    historyCount: externalHistory.length
  });
});

router.get('/ls', (req, res) => {
  res.json({
    total: externalHistory.length,
    canPredict: externalHistory.length >= MIN_HISTORY_FOR_PREDICTION,
    minRequired: MIN_HISTORY_FOR_PREDICTION,
    wsConnected,
    data: externalHistory
  });
});

router.get('/taixiu/ls', (req, res) => {
  res.json({
    id: 'API BY BO NHAY DZ',
    type: 'Sun Tài Xỉu - Lịch sử gốc',
    total: externalHistory.length,
    wsConnected,
    data: externalHistory
  });
});

router.get('/taixiu/lsdudoan', (req, res) => {
  const predictions = learningData.sun?.predictions || [];
  const latestPhien = externalHistory.length > 0 ? parseInt(externalHistory[0].Phien) : 0;
  
  const historyWithStatus = predictions.map(p => {
    let status = '⏳';
    let thucTe = 'Chưa có';
    
    if (p.verified) {
      status = p.isCorrect ? '✅' : '❌';
      thucTe = p.actual || 'Chưa có';
    } else {
      const predPhien = parseInt(p.phien);
      if (latestPhien > 0 && latestPhien - predPhien > 10) {
        status = '⚠️';
        thucTe = 'Không có dữ liệu';
      }
    }
    
    return {
      phien: p.phien,
      du_doan: p.prediction,
      thuc_te: thucTe,
      trang_thai: status,
      ti_le: `${p.confidence}%`,
      timestamp: p.timestamp
    };
  });
  
  res.json({
    id: 'API BY BO NHAY DZ',
    type: 'Sun Tài Xỉu - Lịch sử dự đoán',
    total: historyWithStatus.length,
    data: historyWithStatus
  });
});

loadLearningData();
loadPredictionHistory();
loadExternalHistory();
startAutoSaveTask();
startAutoPrediction();
connectWebSocket();

module.exports = router;
