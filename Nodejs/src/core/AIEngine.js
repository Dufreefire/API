const fs = require('fs');
const path = require('path');

class AIEngine {
  constructor(gameId, options = {}) {
    this.gameId = gameId;
    this.options = {
      minHistoryLength: 10,
      maxHistoryLength: 200,
      learningRate: 0.1,
      adaptiveWeightDecay: 0.95,
      streakBreakThreshold: 5,
      patternConfidenceMultiplier: 1.2,
      ...options
    };
    
    this.learningFile = path.join(__dirname, `../data/ai_learning_${gameId}.json`);
    this.learningData = this.loadLearningData();
    this.patternWeights = this.initializePatternWeights();
    this.transitionMatrix = this.initializeTransitionMatrix();
    this.volatilityHistory = [];
    this.momentumBuffer = [];
  }

  initializePatternWeights() {
    const defaults = {
      'cau_bet_tai': 1.0,
      'cau_bet_xiu': 1.0,
      'cau_dao_11': 1.0,
      'cau_22': 1.0,
      'cau_33': 1.0,
      'cau_44': 1.0,
      'cau_55': 1.0,
      'cau_121': 1.0,
      'cau_123': 1.0,
      'cau_321': 1.0,
      'cau_212': 1.0,
      'cau_1221': 1.0,
      'cau_2112': 1.0,
      'streak_break_early': 1.2,
      'streak_break_late': 1.3,
      'streak_follow': 1.1,
      'alternating_break': 1.15,
      'pair_pattern_break': 1.2,
      'triple_pattern_break': 1.25,
      'momentum_shift': 1.3,
      'distribution_bias': 1.1,
      'sum_pressure': 1.2,
      'volatility_spike': 1.15,
      'resistance_level': 1.25,
      'support_level': 1.25,
      'fibonacci_zone': 1.1,
      'golden_ratio': 1.05,
      'markov_prediction': 1.35,
      'entropy_analysis': 1.2,
      'wave_analysis': 1.15,
      'cycle_detection': 1.3,
      'hot_cold_zone': 1.25,
      'dealer_pattern': 1.4
    };
    
    return { ...defaults, ...(this.learningData.patternWeights || {}) };
  }

  initializeTransitionMatrix() {
    return this.learningData.transitionMatrix || {
      'Tài->Tài': { count: 0, probability: 0.5 },
      'Tài->Xỉu': { count: 0, probability: 0.5 },
      'Xỉu->Tài': { count: 0, probability: 0.5 },
      'Xỉu->Xỉu': { count: 0, probability: 0.5 }
    };
  }

  loadLearningData() {
    try {
      if (fs.existsSync(this.learningFile)) {
        return JSON.parse(fs.readFileSync(this.learningFile, 'utf8'));
      }
    } catch (e) {
      console.error(`[AIEngine-${this.gameId}] Error loading learning data:`, e.message);
    }
    return {
      totalPredictions: 0,
      correctPredictions: 0,
      patternStats: {},
      patternWeights: {},
      transitionMatrix: null,
      streakBreakStats: { success: 0, fail: 0 },
      patternBreakStats: {},
      recentAccuracy: [],
      lastUpdate: null
    };
  }

  saveLearningData() {
    try {
      this.learningData.patternWeights = this.patternWeights;
      this.learningData.transitionMatrix = this.transitionMatrix;
      this.learningData.lastUpdate = new Date().toISOString();
      fs.writeFileSync(this.learningFile, JSON.stringify(this.learningData, null, 2));
    } catch (e) {
      console.error(`[AIEngine-${this.gameId}] Error saving learning data:`, e.message);
    }
  }

  normalizeResult(result) {
    if (!result) return 'Tài';
    const lower = String(result).toLowerCase();
    if (lower.includes('tai') || lower.includes('tài') || lower === 't') return 'Tài';
    if (lower.includes('xiu') || lower.includes('xỉu') || lower === 'x') return 'Xỉu';
    return 'Tài';
  }

  extractResults(history, getResultFn) {
    return history.map(item => this.normalizeResult(getResultFn(item)));
  }

  updateTransitionMatrix(results) {
    if (results.length < 2) return;
    
    const totalTransitions = { 'Tài': 0, 'Xỉu': 0 };
    
    for (let i = 0; i < results.length - 1; i++) {
      const current = results[i];
      const next = results[i + 1];
      const key = `${current}->${next}`;
      
      if (this.transitionMatrix[key]) {
        this.transitionMatrix[key].count++;
        totalTransitions[current]++;
      }
    }
    
    ['Tài', 'Xỉu'].forEach(from => {
      const total = totalTransitions[from] || 1;
      ['Tài', 'Xỉu'].forEach(to => {
        const key = `${from}->${to}`;
        this.transitionMatrix[key].probability = 
          this.transitionMatrix[key].count / Math.max(total, 1);
      });
    });
  }

  markovChainPredict(results) {
    if (results.length < 5) return { detected: false };
    
    this.updateTransitionMatrix(results.slice(0, 50));
    
    const lastResult = results[0];
    const toTai = this.transitionMatrix[`${lastResult}->Tài`]?.probability || 0.5;
    const toXiu = this.transitionMatrix[`${lastResult}->Xỉu`]?.probability || 0.5;
    
    const diff = Math.abs(toTai - toXiu);
    if (diff > 0.1) {
      return {
        detected: true,
        prediction: toTai > toXiu ? 'Tài' : 'Xỉu',
        confidence: Math.min(25, diff * 50) * this.patternWeights['markov_prediction'],
        name: `Markov Chain (${(Math.max(toTai, toXiu) * 100).toFixed(0)}%)`,
        patternId: 'markov_prediction'
      };
    }
    
    return { detected: false };
  }

  detectStreakWithBreakAnalysis(results) {
    if (results.length < 3) return { detected: false };
    
    let streakType = results[0];
    let streakLength = 1;
    
    for (let i = 1; i < results.length && i < 20; i++) {
      if (results[i] === streakType) {
        streakLength++;
      } else {
        break;
      }
    }
    
    if (streakLength >= 3) {
      const historicalBreaks = this.analyzeHistoricalBreaks(results, streakLength);
      const breakStats = this.learningData.streakBreakStats || { success: 0, fail: 0 };
      const totalBreaks = breakStats.success + breakStats.fail;
      const breakSuccessRate = totalBreaks > 10 ? breakStats.success / totalBreaks : 0.5;
      
      let shouldBreak = false;
      let breakConfidence = 0;
      
      if (streakLength >= 7) {
        shouldBreak = true;
        breakConfidence = 20 + (streakLength - 7) * 3;
      } else if (streakLength >= 5) {
        shouldBreak = breakSuccessRate > 0.55 || historicalBreaks.breakProbability > 0.6;
        breakConfidence = 15 + (streakLength - 5) * 2;
      } else if (streakLength >= 4) {
        shouldBreak = historicalBreaks.breakProbability > 0.65;
        breakConfidence = 10 + (streakLength - 4) * 2;
      }
      
      const patternId = shouldBreak ? 
        (streakLength >= 6 ? 'streak_break_late' : 'streak_break_early') : 
        'streak_follow';
      
      const prediction = shouldBreak ? 
        (streakType === 'Tài' ? 'Xỉu' : 'Tài') : 
        streakType;
      
      const baseConfidence = shouldBreak ? 
        breakConfidence : 
        Math.min(18, streakLength * 3);
      
      return {
        detected: true,
        type: streakType,
        length: streakLength,
        shouldBreak,
        historicalBreakRate: historicalBreaks.breakProbability,
        prediction,
        confidence: baseConfidence * this.patternWeights[patternId],
        name: shouldBreak ? 
          `🔥 Cầu Bệt ${streakLength} - BẺ CẦU (${(historicalBreaks.breakProbability * 100).toFixed(0)}%)` :
          `Cầu Bệt ${streakLength} - THEO CẦU`,
        patternId
      };
    }
    
    return { detected: false };
  }

  analyzeHistoricalBreaks(results, currentStreakLength) {
    let breakCount = 0;
    let continueCount = 0;
    
    for (let i = 0; i < results.length - currentStreakLength - 1; i++) {
      let checkStreak = 1;
      const checkType = results[i];
      
      for (let j = i + 1; j < results.length && checkStreak < 20; j++) {
        if (results[j] === checkType) {
          checkStreak++;
        } else {
          break;
        }
      }
      
      if (checkStreak === currentStreakLength) {
        const nextIndex = i + checkStreak;
        if (nextIndex < results.length) {
          if (results[nextIndex] !== checkType) {
            breakCount++;
          } else {
            continueCount++;
          }
        }
      }
    }
    
    const total = breakCount + continueCount;
    return {
      breakCount,
      continueCount,
      breakProbability: total > 0 ? breakCount / total : 0.5
    };
  }

  detectAlternatingPattern(results) {
    if (results.length < 4) return { detected: false };
    
    let alternatingLength = 1;
    for (let i = 1; i < Math.min(results.length, 15); i++) {
      if (results[i] !== results[i - 1]) {
        alternatingLength++;
      } else {
        break;
      }
    }
    
    if (alternatingLength >= 4) {
      const historicalBreaks = this.analyzeAlternatingBreaks(results, alternatingLength);
      
      let shouldBreak = false;
      let prediction = results[0] === 'Tài' ? 'Xỉu' : 'Tài';
      
      if (alternatingLength >= 8) {
        shouldBreak = true;
        prediction = results[0];
      } else if (alternatingLength >= 6 && historicalBreaks.breakProbability > 0.6) {
        shouldBreak = true;
        prediction = results[0];
      }
      
      const patternId = shouldBreak ? 'alternating_break' : 'cau_dao_11';
      const baseConfidence = shouldBreak ? 
        15 + (alternatingLength - 6) * 2 : 
        Math.min(16, alternatingLength * 2 + 6);
      
      return {
        detected: true,
        length: alternatingLength,
        shouldBreak,
        prediction,
        confidence: baseConfidence * this.patternWeights[patternId],
        name: shouldBreak ?
          `🎯 Cầu Đảo ${alternatingLength} - BẺ CẦU (${(historicalBreaks.breakProbability * 100).toFixed(0)}%)` :
          `Cầu Đảo 1-1 (${alternatingLength} phiên)`,
        patternId
      };
    }
    
    return { detected: false };
  }

  analyzeAlternatingBreaks(results, currentLength) {
    let breakCount = 0;
    let continueCount = 0;
    
    for (let i = 0; i < results.length - currentLength - 1; i++) {
      let altLength = 1;
      for (let j = i + 1; j < i + currentLength + 2 && j < results.length; j++) {
        if (results[j] !== results[j - 1]) {
          altLength++;
        } else {
          break;
        }
      }
      
      if (altLength === currentLength) {
        const nextIndex = i + currentLength;
        if (nextIndex < results.length) {
          if (results[nextIndex] === results[nextIndex - 1]) {
            breakCount++;
          } else {
            continueCount++;
          }
        }
      }
    }
    
    const total = breakCount + continueCount;
    return {
      breakCount,
      continueCount,
      breakProbability: total > 0 ? breakCount / total : 0.5
    };
  }

  detectPairPattern(results) {
    if (results.length < 6) return { detected: false };
    
    let pairCount = 0;
    let pairs = [];
    let i = 0;
    
    while (i < results.length - 1 && pairCount < 5) {
      if (results[i] === results[i + 1]) {
        pairs.push(results[i]);
        pairCount++;
        i += 2;
      } else {
        break;
      }
    }
    
    if (pairCount >= 2) {
      let isAlternating = true;
      for (let j = 1; j < pairs.length; j++) {
        if (pairs[j] === pairs[j - 1]) {
          isAlternating = false;
          break;
        }
      }
      
      if (isAlternating) {
        const lastPair = pairs[pairs.length - 1];
        const shouldBreakPair = pairCount >= 4;
        
        let prediction;
        if (shouldBreakPair) {
          prediction = lastPair;
        } else {
          prediction = lastPair === 'Tài' ? 'Xỉu' : 'Tài';
        }
        
        const patternId = shouldBreakPair ? 'pair_pattern_break' : 'cau_22';
        const baseConfidence = pairCount >= 4 ? 
          18 + (pairCount - 4) * 3 : 
          Math.min(14, pairCount * 3 + 4);
        
        return {
          detected: true,
          pairCount,
          pairs,
          shouldBreak: shouldBreakPair,
          prediction,
          confidence: baseConfidence * this.patternWeights[patternId],
          name: shouldBreakPair ?
            `🔄 Cầu 2-2 (${pairCount} cặp) - BẺ CẦU` :
            `Cầu 2-2 (${pairCount} cặp)`,
          patternId
        };
      }
    }
    
    return { detected: false };
  }

  detectTriplePattern(results) {
    if (results.length < 6) return { detected: false };
    
    let tripleCount = 0;
    let triples = [];
    let i = 0;
    
    while (i < results.length - 2) {
      if (results[i] === results[i + 1] && results[i + 1] === results[i + 2]) {
        triples.push(results[i]);
        tripleCount++;
        i += 3;
      } else {
        break;
      }
    }
    
    if (tripleCount >= 1) {
      const currentPosition = results.length % 3;
      const lastTriple = triples[triples.length - 1];
      const shouldBreak = tripleCount >= 2 || currentPosition === 0;
      
      let prediction;
      if (shouldBreak && currentPosition === 0) {
        prediction = lastTriple === 'Tài' ? 'Xỉu' : 'Tài';
      } else {
        prediction = lastTriple;
      }
      
      const patternId = shouldBreak ? 'triple_pattern_break' : 'cau_33';
      const baseConfidence = tripleCount >= 2 ?
        16 + tripleCount * 3 :
        Math.min(15, tripleCount * 4 + 6);
      
      return {
        detected: true,
        tripleCount,
        triples,
        position: currentPosition,
        shouldBreak,
        prediction,
        confidence: baseConfidence * this.patternWeights[patternId],
        name: shouldBreak ?
          `🎲 Cầu 3-3 (${tripleCount} bộ) - BẺ CẦU` :
          `Cầu 3-3 (${tripleCount} bộ ba)`,
        patternId
      };
    }
    
    return { detected: false };
  }

  analyzeDistributionBias(results) {
    if (results.length < 15) return { detected: false };
    
    const recent20 = results.slice(0, 20);
    const recent50 = results.slice(0, Math.min(50, results.length));
    
    const count20 = { Tài: 0, Xỉu: 0 };
    const count50 = { Tài: 0, Xỉu: 0 };
    
    recent20.forEach(r => count20[r]++);
    recent50.forEach(r => count50[r]++);
    
    const ratio20 = count20.Tài / (count20.Tài + count20.Xỉu);
    const ratio50 = count50.Tài / (count50.Tài + count50.Xỉu);
    
    const bias20 = Math.abs(ratio20 - 0.5);
    const bias50 = Math.abs(ratio50 - 0.5);
    
    if (bias20 > 0.25 || bias50 > 0.2) {
      const dominant = count20.Tài > count20.Xỉu ? 'Tài' : 'Xỉu';
      const trendReversal = bias20 > 0.35;
      
      const prediction = trendReversal ? 
        (dominant === 'Tài' ? 'Xỉu' : 'Tài') : 
        dominant;
      
      const confidence = Math.min(18, (bias20 + bias50) * 40);
      
      return {
        detected: true,
        dominant,
        ratio20: (ratio20 * 100).toFixed(1),
        ratio50: (ratio50 * 100).toFixed(1),
        trendReversal,
        prediction,
        confidence: confidence * this.patternWeights['distribution_bias'],
        name: trendReversal ?
          `📊 Phân bố lệch ${dominant} (${(Math.max(ratio20, 1-ratio20) * 100).toFixed(0)}%) - ĐẢO CHIỀU` :
          `📊 Phân bố nghiêng ${dominant}`,
        patternId: 'distribution_bias'
      };
    }
    
    return { detected: false };
  }

  analyzeMomentumShift(results, sums = null) {
    if (results.length < 8) return { detected: false };
    
    const recent5 = results.slice(0, 5);
    const prev5 = results.slice(5, 10);
    
    const countRecent = { Tài: 0, Xỉu: 0 };
    const countPrev = { Tài: 0, Xỉu: 0 };
    
    recent5.forEach(r => countRecent[r]++);
    prev5.forEach(r => countPrev[r]++);
    
    const recentDominant = countRecent.Tài >= countRecent.Xỉu ? 'Tài' : 'Xỉu';
    const prevDominant = countPrev.Tài >= countPrev.Xỉu ? 'Tài' : 'Xỉu';
    
    if (recentDominant !== prevDominant) {
      const shiftStrength = Math.abs(countRecent.Tài - countRecent.Xỉu);
      
      if (shiftStrength >= 3) {
        return {
          detected: true,
          fromDominant: prevDominant,
          toDominant: recentDominant,
          shiftStrength,
          prediction: recentDominant,
          confidence: (12 + shiftStrength * 3) * this.patternWeights['momentum_shift'],
          name: `⚡ Momentum Shift: ${prevDominant} → ${recentDominant}`,
          patternId: 'momentum_shift'
        };
      }
    }
    
    return { detected: false };
  }

  analyzeSumPressure(history, getSumFn) {
    if (history.length < 10 || !getSumFn) return { detected: false };
    
    const sums = history.slice(0, 15).map(item => getSumFn(item)).filter(s => s !== null);
    if (sums.length < 8) return { detected: false };
    
    const avgRecent = sums.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
    const avgPrev = sums.slice(5, 10).reduce((a, b) => a + b, 0) / 5;
    const overallAvg = sums.reduce((a, b) => a + b, 0) / sums.length;
    
    const highPressure = avgRecent > 11.5 && avgRecent > overallAvg;
    const lowPressure = avgRecent < 9.5 && avgRecent < overallAvg;
    
    if (highPressure || lowPressure) {
      const extremePressure = highPressure ? avgRecent > 13 : avgRecent < 8;
      
      let prediction;
      if (extremePressure) {
        prediction = highPressure ? 'Xỉu' : 'Tài';
      } else {
        prediction = highPressure ? 'Tài' : 'Xỉu';
      }
      
      const pressureStrength = Math.abs(avgRecent - 10.5);
      const confidence = Math.min(20, pressureStrength * 4);
      
      return {
        detected: true,
        avgRecent: avgRecent.toFixed(2),
        avgPrev: avgPrev.toFixed(2),
        direction: highPressure ? 'high' : 'low',
        extremePressure,
        prediction,
        confidence: confidence * this.patternWeights['sum_pressure'],
        name: extremePressure ?
          `💥 Sum Pressure cực ${highPressure ? 'CAO' : 'THẤP'} (${avgRecent.toFixed(1)}) - ĐẢO CHIỀU` :
          `📈 Sum Pressure ${highPressure ? 'cao' : 'thấp'} (${avgRecent.toFixed(1)})`,
        patternId: 'sum_pressure'
      };
    }
    
    return { detected: false };
  }

  analyzeVolatility(results) {
    if (results.length < 12) return { detected: false };
    
    let changes = 0;
    for (let i = 1; i < Math.min(12, results.length); i++) {
      if (results[i] !== results[i - 1]) {
        changes++;
      }
    }
    
    const volatility = changes / 11;
    
    if (volatility > 0.7 || volatility < 0.3) {
      const highVolatility = volatility > 0.7;
      
      let prediction;
      if (highVolatility) {
        prediction = results[0] === 'Tài' ? 'Xỉu' : 'Tài';
      } else {
        prediction = results[0];
      }
      
      const extremeVolatility = volatility > 0.85 || volatility < 0.15;
      if (extremeVolatility) {
        prediction = prediction === 'Tài' ? 'Xỉu' : 'Tài';
      }
      
      return {
        detected: true,
        volatility: (volatility * 100).toFixed(1),
        type: highVolatility ? 'high' : 'low',
        extreme: extremeVolatility,
        prediction,
        confidence: (extremeVolatility ? 16 : 12) * this.patternWeights['volatility_spike'],
        name: extremeVolatility ?
          `🌊 Volatility cực ${highVolatility ? 'CAO' : 'THẤP'} (${(volatility * 100).toFixed(0)}%) - ĐẢO CHIỀU` :
          `📉 Volatility ${highVolatility ? 'cao' : 'thấp'} (${(volatility * 100).toFixed(0)}%)`,
        patternId: 'volatility_spike'
      };
    }
    
    return { detected: false };
  }

  detectDealerPattern(results) {
    if (results.length < 20) return { detected: false };
    
    const patterns = {
      'bet5_break': 0,
      'bet6_break': 0,
      'bet7_break': 0,
      'bet5_continue': 0,
      'bet6_continue': 0,
      'bet7_continue': 0,
      'alt6_break': 0,
      'alt6_continue': 0,
      'alt8_break': 0,
      'alt8_continue': 0
    };
    
    for (let i = 0; i < results.length - 8; i++) {
      let streak = 1;
      const streakType = results[i];
      
      for (let j = i + 1; j < results.length && streak < 10; j++) {
        if (results[j] === streakType) {
          streak++;
        } else {
          break;
        }
      }
      
      if (streak === 5) {
        const next = i > 0 ? results[i - 1] : null;
        if (next) {
          if (next !== streakType) patterns['bet5_break']++;
          else patterns['bet5_continue']++;
        }
      } else if (streak === 6) {
        const next = i > 0 ? results[i - 1] : null;
        if (next) {
          if (next !== streakType) patterns['bet6_break']++;
          else patterns['bet6_continue']++;
        }
      } else if (streak === 7) {
        const next = i > 0 ? results[i - 1] : null;
        if (next) {
          if (next !== streakType) patterns['bet7_break']++;
          else patterns['bet7_continue']++;
        }
      }
    }
    
    let currentStreak = 1;
    const currentType = results[0];
    for (let i = 1; i < results.length && i < 15; i++) {
      if (results[i] === currentType) {
        currentStreak++;
      } else {
        break;
      }
    }
    
    if (currentStreak >= 5 && currentStreak <= 7) {
      const breakKey = `bet${currentStreak}_break`;
      const continueKey = `bet${currentStreak}_continue`;
      const breakCount = patterns[breakKey] || 0;
      const continueCount = patterns[continueKey] || 0;
      const total = breakCount + continueCount;
      
      if (total >= 3) {
        const breakRate = breakCount / total;
        const shouldBreak = breakRate > 0.55;
        
        const prediction = shouldBreak ?
          (currentType === 'Tài' ? 'Xỉu' : 'Tài') :
          currentType;
        
        return {
          detected: true,
          streakLength: currentStreak,
          streakType: currentType,
          breakRate: (breakRate * 100).toFixed(1),
          sampleSize: total,
          shouldBreak,
          prediction,
          confidence: (15 + Math.min(10, total * 2)) * this.patternWeights['dealer_pattern'],
          name: `🎰 Dealer Pattern: Cầu ${currentStreak} (${(breakRate * 100).toFixed(0)}% bẻ)`,
          patternId: 'dealer_pattern'
        };
      }
    }
    
    return { detected: false };
  }

  analyzeHotColdZone(results) {
    if (results.length < 30) return { detected: false };
    
    const recent10 = results.slice(0, 10);
    const middle10 = results.slice(10, 20);
    const older10 = results.slice(20, 30);
    
    const countRecent = { Tài: 0, Xỉu: 0 };
    const countMiddle = { Tài: 0, Xỉu: 0 };
    const countOlder = { Tài: 0, Xỉu: 0 };
    
    recent10.forEach(r => countRecent[r]++);
    middle10.forEach(r => countMiddle[r]++);
    older10.forEach(r => countOlder[r]++);
    
    const trendRecent = countRecent.Tài - countRecent.Xỉu;
    const trendMiddle = countMiddle.Tài - countMiddle.Xỉu;
    const trendOlder = countOlder.Tài - countOlder.Xỉu;
    
    const hotZone = trendRecent > 3 && trendRecent > trendMiddle;
    const coldZone = trendRecent < -3 && trendRecent < trendMiddle;
    
    if (hotZone || coldZone) {
      const zoneDominant = hotZone ? 'Tài' : 'Xỉu';
      const extremeZone = Math.abs(trendRecent) >= 6;
      
      let prediction;
      if (extremeZone) {
        prediction = zoneDominant === 'Tài' ? 'Xỉu' : 'Tài';
      } else {
        prediction = zoneDominant;
      }
      
      const trendDirection = trendRecent > trendMiddle && trendMiddle > trendOlder ? 'increasing' : 'decreasing';
      
      return {
        detected: true,
        zone: hotZone ? 'hot' : 'cold',
        zoneDominant,
        trendRecent,
        trendMiddle,
        trendOlder,
        trendDirection,
        extremeZone,
        prediction,
        confidence: (extremeZone ? 18 : 14) * this.patternWeights['hot_cold_zone'],
        name: extremeZone ?
          `🔥 ${hotZone ? 'HOT' : 'COLD'} Zone cực (${zoneDominant} ${Math.abs(trendRecent)}/10) - ĐẢO CHIỀU` :
          `${hotZone ? '🔥 HOT' : '❄️ COLD'} Zone ${zoneDominant}`,
        patternId: 'hot_cold_zone'
      };
    }
    
    return { detected: false };
  }

  detectCyclePattern(results) {
    if (results.length < 15) return { detected: false };
    
    for (let cycleLen = 3; cycleLen <= 6; cycleLen++) {
      let matches = 0;
      const potentialCycle = results.slice(0, cycleLen);
      
      for (let i = cycleLen; i < Math.min(results.length, cycleLen * 4); i += cycleLen) {
        const segment = results.slice(i, i + cycleLen);
        if (segment.length === cycleLen) {
          let segmentMatches = 0;
          for (let j = 0; j < cycleLen; j++) {
            if (segment[j] === potentialCycle[j]) {
              segmentMatches++;
            }
          }
          if (segmentMatches >= cycleLen - 1) {
            matches++;
          }
        }
      }
      
      if (matches >= 2) {
        const positionInCycle = 0;
        const prediction = potentialCycle[positionInCycle];
        
        return {
          detected: true,
          cycleLength: cycleLen,
          cyclePattern: potentialCycle.join(''),
          matchCount: matches,
          prediction,
          confidence: (12 + matches * 3) * this.patternWeights['cycle_detection'],
          name: `🔄 Chu kỳ ${cycleLen} (${matches + 1} lặp)`,
          patternId: 'cycle_detection'
        };
      }
    }
    
    return { detected: false };
  }

  generatePrediction(history, getResultFn, getSumFn = null) {
    if (history.length < this.options.minHistoryLength) {
      return {
        prediction: Math.random() < 0.5 ? 'Tài' : 'Xỉu',
        confidence: 50,
        reason: 'Chưa đủ dữ liệu lịch sử để phân tích AI',
        patterns: [],
        aiScore: 0
      };
    }
    
    const results = this.extractResults(history.slice(0, this.options.maxHistoryLength), getResultFn);
    
    const analyses = [];
    
    const streak = this.detectStreakWithBreakAnalysis(results);
    if (streak.detected) analyses.push(streak);
    
    const alternating = this.detectAlternatingPattern(results);
    if (alternating.detected) analyses.push(alternating);
    
    const pairs = this.detectPairPattern(results);
    if (pairs.detected) analyses.push(pairs);
    
    const triples = this.detectTriplePattern(results);
    if (triples.detected) analyses.push(triples);
    
    const markov = this.markovChainPredict(results);
    if (markov.detected) analyses.push(markov);
    
    const distribution = this.analyzeDistributionBias(results);
    if (distribution.detected) analyses.push(distribution);
    
    const momentum = this.analyzeMomentumShift(results);
    if (momentum.detected) analyses.push(momentum);
    
    const sumPressure = this.analyzeSumPressure(history, getSumFn);
    if (sumPressure.detected) analyses.push(sumPressure);
    
    const volatility = this.analyzeVolatility(results);
    if (volatility.detected) analyses.push(volatility);
    
    const dealer = this.detectDealerPattern(results);
    if (dealer.detected) analyses.push(dealer);
    
    const hotCold = this.analyzeHotColdZone(results);
    if (hotCold.detected) analyses.push(hotCold);
    
    const cycle = this.detectCyclePattern(results);
    if (cycle.detected) analyses.push(cycle);
    
    if (analyses.length === 0) {
      const fallbackPred = results[0] === 'Tài' ? 'Xỉu' : 'Tài';
      return {
        prediction: fallbackPred,
        confidence: 52,
        reason: 'Không phát hiện pattern rõ ràng - dự đoán đảo chiều',
        patterns: [],
        aiScore: 0
      };
    }
    
    analyses.sort((a, b) => b.confidence - a.confidence);
    
    let taiScore = 0;
    let xiuScore = 0;
    
    analyses.forEach((analysis, index) => {
      const priorityMultiplier = 1 - (index * 0.05);
      const score = analysis.confidence * priorityMultiplier;
      
      if (analysis.prediction === 'Tài') {
        taiScore += score;
      } else {
        xiuScore += score;
      }
    });
    
    const finalPrediction = taiScore > xiuScore ? 'Tài' : 'Xỉu';
    const totalScore = taiScore + xiuScore;
    const winningScore = Math.max(taiScore, xiuScore);
    const finalConfidence = Math.min(95, 50 + (winningScore / totalScore - 0.5) * 80);
    
    const topPatterns = analyses.slice(0, 3).map(a => ({
      name: a.name,
      prediction: a.prediction,
      confidence: a.confidence.toFixed(1)
    }));
    
    const reasons = analyses.slice(0, 3).map(a => a.name).join(' + ');
    
    return {
      prediction: finalPrediction,
      confidence: Math.round(finalConfidence),
      reason: `AI Analysis: ${reasons}`,
      patterns: topPatterns,
      aiScore: (winningScore / totalScore * 100).toFixed(1),
      allAnalyses: analyses.map(a => ({
        name: a.name,
        prediction: a.prediction,
        confidence: a.confidence.toFixed(1),
        patternId: a.patternId
      }))
    };
  }

  updateLearning(prediction, actual, patterns) {
    const isCorrect = prediction === actual;
    
    this.learningData.totalPredictions++;
    if (isCorrect) {
      this.learningData.correctPredictions++;
    }
    
    this.learningData.recentAccuracy.push(isCorrect ? 1 : 0);
    if (this.learningData.recentAccuracy.length > 100) {
      this.learningData.recentAccuracy.shift();
    }
    
    if (patterns && patterns.length > 0) {
      patterns.forEach(pattern => {
        const patternId = pattern.patternId || pattern.name;
        if (!this.learningData.patternStats[patternId]) {
          this.learningData.patternStats[patternId] = {
            total: 0,
            correct: 0,
            recentResults: []
          };
        }
        
        const stats = this.learningData.patternStats[patternId];
        stats.total++;
        if (isCorrect) stats.correct++;
        
        stats.recentResults.push(isCorrect ? 1 : 0);
        if (stats.recentResults.length > 30) {
          stats.recentResults.shift();
        }
        
        const recentAcc = stats.recentResults.reduce((a, b) => a + b, 0) / stats.recentResults.length;
        
        if (stats.recentResults.length >= 10) {
          if (recentAcc > 0.6) {
            this.patternWeights[patternId] = Math.min(2.0, (this.patternWeights[patternId] || 1) * 1.03);
          } else if (recentAcc < 0.4) {
            this.patternWeights[patternId] = Math.max(0.4, (this.patternWeights[patternId] || 1) * 0.97);
          }
        }
      });
    }
    
    if (patterns && patterns.some(p => 
      p.patternId?.includes('break') || 
      p.name?.includes('BẺ CẦU')
    )) {
      if (isCorrect) {
        this.learningData.streakBreakStats.success++;
      } else {
        this.learningData.streakBreakStats.fail++;
      }
    }
    
    this.saveLearningData();
  }

  getStats() {
    const total = this.learningData.totalPredictions || 0;
    const correct = this.learningData.correctPredictions || 0;
    const recentAcc = this.learningData.recentAccuracy || [];
    
    return {
      gameId: this.gameId,
      totalPredictions: total,
      correctPredictions: correct,
      overallAccuracy: total > 0 ? ((correct / total) * 100).toFixed(2) + '%' : 'N/A',
      recentAccuracy: recentAcc.length > 0 
        ? ((recentAcc.reduce((a, b) => a + b, 0) / recentAcc.length) * 100).toFixed(2) + '%'
        : 'N/A',
      streakBreakStats: this.learningData.streakBreakStats,
      topPatterns: this.getTopPatterns(),
      lastUpdate: this.learningData.lastUpdate
    };
  }

  getTopPatterns() {
    const stats = this.learningData.patternStats || {};
    return Object.entries(stats)
      .filter(([_, v]) => v.total >= 5)
      .map(([k, v]) => ({
        pattern: k,
        accuracy: ((v.correct / v.total) * 100).toFixed(1) + '%',
        weight: (this.patternWeights[k] || 1).toFixed(2),
        total: v.total
      }))
      .sort((a, b) => parseFloat(b.accuracy) - parseFloat(a.accuracy))
      .slice(0, 10);
  }
}

module.exports = AIEngine;
