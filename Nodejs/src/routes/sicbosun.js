const express = require('express');
const router = express.Router();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const API_URL = 'https://api.wsktnus8.net/v2/history/getLastResult?gameId=ktrng_3979&size=100&tableId=39791215743193&curPage=1';
const HISTORY_FILE = path.join(__dirname, '../../data/sicbosun_history.json');
const LEARNING_FILE = path.join(__dirname, '../../data/sicbosun_learning.json');
const AUTO_PREDICT_INTERVAL = 3000;

let historyData = [];
let lastPredictedPhien = null;
let lastPrediction = { phien: null, du_doan: null, doan_vi: [], do_tin_cay: 0, reason: "", patterns: [] };

let learningData = {
    totalPredictions: 0,
    correctPredictions: 0,
    patternStats: {},
    dicePatternStats: {},
    lastUpdate: null
};

function loadPredictionHistory() {
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
        }
    } catch (e) {
        console.error('SicboSun - Lỗi đọc lịch sử:', e.message);
    }
    return [];
}

function savePredictionHistory(data) {
    try {
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('SicboSun - Lỗi lưu lịch sử:', e.message);
    }
}

function normalizePhien(phien) {
    if (!phien) return '';
    return String(phien).replace(/^#?0*/, '');
}

function updatePredictionResults() {
    if (historyData.length === 0) return;
    
    let predHist = loadPredictionHistory();
    let updated = false;
    
    const historyMap = {};
    let latestPhien = 0;
    historyData.forEach(h => {
        const phien = normalizePhien(h.gameNum);
        if (phien) {
            historyMap[phien] = getResultType(h);
            const phienNum = parseInt(phien);
            if (phienNum > latestPhien) latestPhien = phienNum;
        }
    });
    
    predHist.forEach(p => {
        if (p.ket_qua_thuc === null || p.ket_qua_thuc === undefined) {
            const phien = normalizePhien(p.phien);
            if (historyMap[phien]) {
                p.ket_qua_thuc = historyMap[phien];
                updated = true;
            }
        }
    });
    
    const oldLength = predHist.length;
    predHist = predHist.filter(p => {
        if (p.ket_qua_thuc !== null && p.ket_qua_thuc !== undefined) return true;
        const phienNum = parseInt(normalizePhien(p.phien));
        if (latestPhien - phienNum > 150) return false;
        return true;
    });
    
    if (predHist.length !== oldLength) {
        updated = true;
        console.log(`[SicboSun] Cleaned ${oldLength - predHist.length} old unverified predictions`);
    }
    
    if (updated) {
        savePredictionHistory(predHist);
    }
}

function loadLearningData() {
    try {
        if (fs.existsSync(LEARNING_FILE)) {
            learningData = JSON.parse(fs.readFileSync(LEARNING_FILE, 'utf8'));
        }
    } catch (e) {
        console.error('SicboSun - Lỗi đọc learning data:', e.message);
    }
}

function saveLearningData() {
    try {
        fs.writeFileSync(LEARNING_FILE, JSON.stringify(learningData, null, 2));
    } catch (e) {
        console.error('SicboSun - Lỗi lưu learning data:', e.message);
    }
}

async function updateHistory() {
    try {
        const res = await axios.get(API_URL);
        if (res?.data?.data?.resultList) {
            historyData = res.data.data.resultList;
        }
    } catch (e) {
        console.error('SicboSun - Lỗi cập nhật:', e.message);
    }
}

function getResultType(session) {
    if (!session || !session.facesList) return "";
    const [a, b, c] = session.facesList;
    if (a === b && b === c) return "Bão";
    return session.score >= 11 ? "Tài" : "Xỉu";
}

function analyzeCauBet(history) {
    if (history.length < 3) return { detected: false };
    
    const results = history.slice(0, 20).map(h => getResultType(h));
    let streakLength = 1;
    const streakType = results[0];
    
    for (let i = 1; i < results.length; i++) {
        if (results[i] === streakType && results[i] !== "Bão") {
            streakLength++;
        } else {
            break;
        }
    }
    
    if (streakLength >= 3) {
        const shouldBreak = streakLength >= 6;
        return {
            detected: true,
            type: streakType,
            length: streakLength,
            prediction: shouldBreak ? (streakType === 'Tài' ? 'Xỉu' : 'Tài') : streakType,
            confidence: shouldBreak ? Math.min(15, streakLength * 2) : Math.min(18, streakLength * 3),
            name: `Cầu Bệt ${streakLength} phiên`,
            patternId: 'cau_bet'
        };
    }
    
    return { detected: false };
}

function analyzeCauDao11(history) {
    if (history.length < 4) return { detected: false };
    
    const results = history.slice(0, 10).map(h => getResultType(h)).filter(r => r !== "Bão");
    let alternatingLength = 1;
    
    for (let i = 1; i < results.length; i++) {
        if (results[i] !== results[i - 1]) {
            alternatingLength++;
        } else {
            break;
        }
    }
    
    if (alternatingLength >= 4) {
        return {
            detected: true,
            length: alternatingLength,
            prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
            confidence: Math.min(16, alternatingLength * 2 + 6),
            name: `Cầu Đảo 1-1 (${alternatingLength} phiên)`,
            patternId: 'cau_dao_11'
        };
    }
    
    return { detected: false };
}

function analyzeCau22(history) {
    if (history.length < 6) return { detected: false };
    
    const results = history.slice(0, 20).map(h => getResultType(h)).filter(r => r !== "Bão");
    let pairCount = 0;
    let i = 0;
    let pattern = [];
    
    while (i < results.length - 1 && pairCount < 4) {
        if (results[i] === results[i + 1]) {
            pattern.push(results[i]);
            pairCount++;
            i += 2;
        } else {
            break;
        }
    }
    
    if (pairCount >= 2) {
        let isAlternating = true;
        for (let j = 1; j < pattern.length; j++) {
            if (pattern[j] === pattern[j - 1]) {
                isAlternating = false;
                break;
            }
        }
        
        if (isAlternating) {
            const lastPairType = pattern[pattern.length - 1];
            const positionInPair = results.length % 2;
            
            return {
                detected: true,
                pairCount,
                prediction: positionInPair === 0 ? (lastPairType === 'Tài' ? 'Xỉu' : 'Tài') : lastPairType,
                confidence: Math.min(14, pairCount * 3 + 4),
                name: `Cầu 2-2 (${pairCount} cặp)`,
                patternId: 'cau_22'
            };
        }
    }
    
    return { detected: false };
}

function analyzeCau33(history) {
    if (history.length < 6) return { detected: false };
    
    const results = history.slice(0, 20).map(h => getResultType(h)).filter(r => r !== "Bão");
    let tripleCount = 0;
    let i = 0;
    let pattern = [];
    
    while (i < results.length - 2) {
        if (results[i] === results[i + 1] && results[i + 1] === results[i + 2]) {
            pattern.push(results[i]);
            tripleCount++;
            i += 3;
        } else {
            break;
        }
    }
    
    if (tripleCount >= 1) {
        const currentPosition = results.length % 3;
        const lastTripleType = pattern[pattern.length - 1];
        
        let prediction;
        if (currentPosition === 0) {
            prediction = lastTripleType === 'Tài' ? 'Xỉu' : 'Tài';
        } else {
            prediction = lastTripleType;
        }
        
        return {
            detected: true,
            tripleCount,
            prediction,
            confidence: Math.min(15, tripleCount * 4 + 6),
            name: `Cầu 3-3 (${tripleCount} bộ ba)`,
            patternId: 'cau_33'
        };
    }
    
    return { detected: false };
}

function analyzeCau123(history) {
    if (history.length < 6) return { detected: false };
    
    const results = history.slice(0, 10).map(h => getResultType(h)).filter(r => r !== "Bão");
    if (results.length < 6) return { detected: false };
    
    const first = results[5];
    const nextTwo = results.slice(3, 5);
    const lastThree = results.slice(0, 3);
    
    if (nextTwo[0] === nextTwo[1] && nextTwo[0] !== first) {
        const allSame = lastThree.every(r => r === lastThree[0]);
        if (allSame && lastThree[0] !== nextTwo[0]) {
            return {
                detected: true,
                pattern: '1-2-3',
                prediction: first,
                confidence: 13,
                name: 'Cầu 1-2-3',
                patternId: 'cau_123'
            };
        }
    }
    
    return { detected: false };
}

function analyzeCauGay(history) {
    if (history.length < 5) return { detected: false };
    
    const results = history.slice(0, 15).map(h => getResultType(h)).filter(r => r !== "Bão");
    
    let streakLength = 1;
    for (let i = 1; i < results.length; i++) {
        if (results[i] === results[0]) {
            streakLength++;
        } else {
            break;
        }
    }
    
    if (streakLength >= 4) {
        const breakPoint = streakLength;
        if (results[breakPoint] && results[breakPoint] !== results[0]) {
            return {
                detected: true,
                streakLength,
                breakType: results[breakPoint],
                prediction: results[breakPoint],
                confidence: Math.min(14, streakLength * 2 + 3),
                name: `Cầu Gãy (bẻ cầu ${streakLength} phiên)`,
                patternId: 'cau_gay'
            };
        }
    }
    
    return { detected: false };
}

function analyzeDicePattern(history) {
    if (history.length < 5) return { detected: false };
    
    const diceData = history.slice(0, 10).map(h => ({
        d1: h.facesList?.[0] || 0,
        d2: h.facesList?.[1] || 0,
        d3: h.facesList?.[2] || 0,
        sum: h.score || 0
    }));
    
    let highDiceCount = 0;
    let lowDiceCount = 0;
    let totalDice = 0;
    
    diceData.forEach(d => {
        [d.d1, d.d2, d.d3].forEach(dice => {
            if (dice >= 4) highDiceCount++;
            else lowDiceCount++;
            totalDice++;
        });
    });
    
    const highRatio = highDiceCount / totalDice;
    
    if (highRatio >= 0.65) {
        return {
            detected: true,
            type: 'high_dice_trend',
            prediction: 'Tài',
            confidence: Math.round(10 + highRatio * 8),
            name: `Xu hướng xúc xắc cao (${(highRatio * 100).toFixed(0)}%)`,
            patternId: 'dice_trend_high'
        };
    } else if (highRatio <= 0.35) {
        return {
            detected: true,
            type: 'low_dice_trend',
            prediction: 'Xỉu',
            confidence: Math.round(10 + (1 - highRatio) * 8),
            name: `Xu hướng xúc xắc thấp (${((1 - highRatio) * 100).toFixed(0)}%)`,
            patternId: 'dice_trend_low'
        };
    }
    
    return { detected: false };
}

function analyzeIndividualDice(history) {
    if (history.length < 8) return { detected: false };
    
    const dice1 = history.slice(0, 8).map(h => h.facesList?.[0] || 0);
    const dice2 = history.slice(0, 8).map(h => h.facesList?.[1] || 0);
    const dice3 = history.slice(0, 8).map(h => h.facesList?.[2] || 0);
    
    const avgD1 = dice1.reduce((a, b) => a + b, 0) / dice1.length;
    const avgD2 = dice2.reduce((a, b) => a + b, 0) / dice2.length;
    const avgD3 = dice3.reduce((a, b) => a + b, 0) / dice3.length;
    
    const avgTotal = avgD1 + avgD2 + avgD3;
    
    if (avgTotal >= 11.5) {
        return {
            detected: true,
            avgD1: avgD1.toFixed(2),
            avgD2: avgD2.toFixed(2),
            avgD3: avgD3.toFixed(2),
            prediction: 'Tài',
            confidence: Math.min(14, Math.round((avgTotal - 10.5) * 4)),
            name: `Phân tích xúc xắc: TB=${avgTotal.toFixed(1)}`,
            patternId: 'individual_dice'
        };
    } else if (avgTotal <= 9.5) {
        return {
            detected: true,
            avgD1: avgD1.toFixed(2),
            avgD2: avgD2.toFixed(2),
            avgD3: avgD3.toFixed(2),
            prediction: 'Xỉu',
            confidence: Math.min(14, Math.round((10.5 - avgTotal) * 4)),
            name: `Phân tích xúc xắc: TB=${avgTotal.toFixed(1)}`,
            patternId: 'individual_dice'
        };
    }
    
    return { detected: false };
}

function analyzeSumTrend(history) {
    if (history.length < 6) return { detected: false };
    
    const sums = history.slice(0, 10).map(h => h.score || 0);
    const recent5 = sums.slice(0, 5);
    const older5 = sums.slice(5, 10);
    
    const recentAvg = recent5.reduce((a, b) => a + b, 0) / recent5.length;
    const olderAvg = older5.length > 0 ? older5.reduce((a, b) => a + b, 0) / older5.length : 10.5;
    
    const trend = recentAvg - olderAvg;
    
    if (trend >= 1.5) {
        return {
            detected: true,
            trend: 'increasing',
            recentAvg: recentAvg.toFixed(2),
            olderAvg: olderAvg.toFixed(2),
            prediction: 'Tài',
            confidence: Math.min(12, Math.round(trend * 3)),
            name: `Xu hướng tăng điểm (+${trend.toFixed(1)})`,
            patternId: 'sum_trend_up'
        };
    } else if (trend <= -1.5) {
        return {
            detected: true,
            trend: 'decreasing',
            recentAvg: recentAvg.toFixed(2),
            olderAvg: olderAvg.toFixed(2),
            prediction: 'Xỉu',
            confidence: Math.min(12, Math.round(Math.abs(trend) * 3)),
            name: `Xu hướng giảm điểm (${trend.toFixed(1)})`,
            patternId: 'sum_trend_down'
        };
    }
    
    return { detected: false };
}

function analyzeDistribution(history) {
    if (history.length < 15) return { detected: false };
    
    const results = history.slice(0, 20).map(h => getResultType(h));
    const taiCount = results.filter(r => r === 'Tài').length;
    const xiuCount = results.filter(r => r === 'Xỉu').length;
    const total = taiCount + xiuCount;
    
    if (total === 0) return { detected: false };
    
    const taiRatio = taiCount / total;
    
    if (taiRatio >= 0.7) {
        return {
            detected: true,
            taiRatio: (taiRatio * 100).toFixed(1),
            prediction: 'Xỉu',
            confidence: Math.round((taiRatio - 0.5) * 25),
            name: `Phân phối lệch Tài (${(taiRatio * 100).toFixed(0)}%)`,
            patternId: 'distribution_bias'
        };
    } else if (taiRatio <= 0.3) {
        return {
            detected: true,
            xiuRatio: ((1 - taiRatio) * 100).toFixed(1),
            prediction: 'Tài',
            confidence: Math.round((0.5 - taiRatio) * 25),
            name: `Phân phối lệch Xỉu (${((1 - taiRatio) * 100).toFixed(0)}%)`,
            patternId: 'distribution_bias'
        };
    }
    
    return { detected: false };
}

function analyzeRecentMomentum(history) {
    if (history.length < 5) return { detected: false };
    
    const recent5 = history.slice(0, 5).map(h => getResultType(h)).filter(r => r !== "Bão");
    const taiCount = recent5.filter(r => r === 'Tài').length;
    
    if (taiCount >= 4) {
        return {
            detected: true,
            momentum: 'strong_tai',
            prediction: 'Tài',
            confidence: 10 + taiCount * 2,
            name: `Momentum mạnh Tài (${taiCount}/5)`,
            patternId: 'momentum'
        };
    } else if (taiCount <= 1) {
        return {
            detected: true,
            momentum: 'strong_xiu',
            prediction: 'Xỉu',
            confidence: 10 + (5 - taiCount) * 2,
            name: `Momentum mạnh Xỉu (${5 - taiCount}/5)`,
            patternId: 'momentum'
        };
    }
    
    return { detected: false };
}

function predictSmartVi(prediction, history) {
    let possibleSums = [];
    if (prediction === "Tài") possibleSums = [11, 12, 13, 14, 15, 16, 17];
    else if (prediction === "Xỉu") possibleSums = [4, 5, 6, 7, 8, 9, 10];
    else return [3, 6, 9, 12, 15, 18].slice(0, 3);
    
    const historicalSums = history.slice(0, 10)
        .filter(h => getResultType(h) === prediction)
        .map(h => h.score);
    
    const sumFrequency = {};
    historicalSums.forEach(sum => {
        sumFrequency[sum] = (sumFrequency[sum] || 0) + 1;
    });
    
    const sortedSums = possibleSums.sort((a, b) => {
        const freqA = sumFrequency[a] || 0;
        const freqB = sumFrequency[b] || 0;
        return freqB - freqA;
    });
    
    return sortedSums.slice(0, 3);
}

function generateAdvancedPrediction() {
    if (historyData.length < 5) {
        const randomPred = Math.random() < 0.5 ? "Tài" : "Xỉu";
        return {
            prediction: randomPred,
            doan_vi: randomPred === "Tài" ? [11, 13, 14] : [5, 7, 9],
            do_tin_cay: "62.00%",
            reason: "Chưa đủ dữ liệu lịch sử để phân tích",
            patterns: []
        };
    }
    
    let predictions = [];
    let allPatterns = [];
    
    const cauBet = analyzeCauBet(historyData);
    if (cauBet.detected) {
        predictions.push({ prediction: cauBet.prediction, confidence: cauBet.confidence, priority: 10, name: cauBet.name });
        allPatterns.push(cauBet);
    }
    
    const cauDao11 = analyzeCauDao11(historyData);
    if (cauDao11.detected) {
        predictions.push({ prediction: cauDao11.prediction, confidence: cauDao11.confidence, priority: 9, name: cauDao11.name });
        allPatterns.push(cauDao11);
    }
    
    const cau22 = analyzeCau22(historyData);
    if (cau22.detected) {
        predictions.push({ prediction: cau22.prediction, confidence: cau22.confidence, priority: 8, name: cau22.name });
        allPatterns.push(cau22);
    }
    
    const cau33 = analyzeCau33(historyData);
    if (cau33.detected) {
        predictions.push({ prediction: cau33.prediction, confidence: cau33.confidence, priority: 8, name: cau33.name });
        allPatterns.push(cau33);
    }
    
    const cau123 = analyzeCau123(historyData);
    if (cau123.detected) {
        predictions.push({ prediction: cau123.prediction, confidence: cau123.confidence, priority: 7, name: cau123.name });
        allPatterns.push(cau123);
    }
    
    const cauGay = analyzeCauGay(historyData);
    if (cauGay.detected) {
        predictions.push({ prediction: cauGay.prediction, confidence: cauGay.confidence, priority: 9, name: cauGay.name });
        allPatterns.push(cauGay);
    }
    
    const dicePattern = analyzeDicePattern(historyData);
    if (dicePattern.detected) {
        predictions.push({ prediction: dicePattern.prediction, confidence: dicePattern.confidence, priority: 6, name: dicePattern.name });
        allPatterns.push(dicePattern);
    }
    
    const individualDice = analyzeIndividualDice(historyData);
    if (individualDice.detected) {
        predictions.push({ prediction: individualDice.prediction, confidence: individualDice.confidence, priority: 7, name: individualDice.name });
        allPatterns.push(individualDice);
    }
    
    const sumTrend = analyzeSumTrend(historyData);
    if (sumTrend.detected) {
        predictions.push({ prediction: sumTrend.prediction, confidence: sumTrend.confidence, priority: 5, name: sumTrend.name });
        allPatterns.push(sumTrend);
    }
    
    const distribution = analyzeDistribution(historyData);
    if (distribution.detected) {
        predictions.push({ prediction: distribution.prediction, confidence: distribution.confidence, priority: 4, name: distribution.name });
        allPatterns.push(distribution);
    }
    
    const momentum = analyzeRecentMomentum(historyData);
    if (momentum.detected) {
        predictions.push({ prediction: momentum.prediction, confidence: momentum.confidence, priority: 6, name: momentum.name });
        allPatterns.push(momentum);
    }
    
    if (predictions.length === 0) {
        const results = historyData.slice(0, 10).map(h => getResultType(h)).filter(r => r !== "Bão");
        const taiCount = results.filter(r => r === 'Tài').length;
        const defaultPred = taiCount > results.length / 2 ? 'Xỉu' : 'Tài';
        
        return {
            prediction: defaultPred,
            doan_vi: predictSmartVi(defaultPred, historyData),
            do_tin_cay: "65.00%",
            reason: "Không phát hiện cầu rõ ràng, dự đoán theo xu hướng cân bằng",
            patterns: []
        };
    }
    
    predictions.sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        return b.confidence - a.confidence;
    });
    
    let taiScore = 0, xiuScore = 0;
    predictions.forEach(p => {
        const weight = p.priority * p.confidence;
        if (p.prediction === 'Tài') taiScore += weight;
        else xiuScore += weight;
    });
    
    const finalPrediction = taiScore >= xiuScore ? 'Tài' : 'Xỉu';
    
    let baseConfidence = 60;
    predictions.forEach(p => {
        if (p.prediction === finalPrediction) {
            baseConfidence += p.confidence * 0.3;
        } else {
            baseConfidence -= p.confidence * 0.1;
        }
    });
    
    const finalConfidence = Math.min(97.5, Math.max(55, baseConfidence));
    
    const topPatterns = allPatterns
        .filter(p => p.prediction === finalPrediction)
        .slice(0, 3)
        .map(p => p.name);
    
    const reason = topPatterns.length > 0 
        ? `Dựa trên: ${topPatterns.join(', ')}`
        : 'Phân tích tổng hợp nhiều yếu tố';
    
    return {
        prediction: finalPrediction,
        doan_vi: predictSmartVi(finalPrediction, historyData),
        do_tin_cay: `${finalConfidence.toFixed(2)}%`,
        reason,
        patterns: allPatterns.map(p => ({ name: p.name, prediction: p.prediction, confidence: p.confidence }))
    };
}

router.get('/', async (req, res) => {
    await updateHistory();
    
    const latestSessionData = historyData[0] || {};
    const latestPhien = latestSessionData.gameNum ? latestSessionData.gameNum.replace('#', '') : null;
    
    if (!latestPhien) {
        return res.status(503).json({ error: "Không thể lấy dữ liệu lịch sử, vui lòng thử lại." });
    }
    
    const nextPhien = (parseInt(latestPhien) + 1).toString();
    
    if (nextPhien !== lastPrediction.phien) {
        const result = generateAdvancedPrediction();
        lastPrediction = {
            phien: nextPhien,
            du_doan: result.prediction,
            doan_vi: result.doan_vi,
            do_tin_cay: result.do_tin_cay,
            reason: result.reason,
            patterns: result.patterns
        };
        
        const predHist = loadPredictionHistory();
        predHist.push({
            phien: nextPhien,
            du_doan: result.prediction,
            doan_vi: result.doan_vi,
            do_tin_cay: result.do_tin_cay,
            reason: result.reason,
            patterns: result.patterns.map(p => p.name),
            ket_qua_thuc: null,
            timestamp: Date.now()
        });
        if (predHist.length > 100) predHist.shift();
        savePredictionHistory(predHist);
    }
    
    res.json({
        id: "API SICBO SUN - Advanced Algorithm",
        Phien: latestPhien,
        Xuc_xac_1: latestSessionData?.facesList?.[0] || 0,
        Xuc_xac_2: latestSessionData?.facesList?.[1] || 0,
        Xuc_xac_3: latestSessionData?.facesList?.[2] || 0,
        Tong: latestSessionData?.score || 0,
        Ket_qua: getResultType(latestSessionData) || "",
        phien_hien_tai: nextPhien,
        du_doan: lastPrediction.du_doan,
        dudoan_vi: lastPrediction.doan_vi.join(", "),
        do_tin_cay: lastPrediction.do_tin_cay,
        ly_do: lastPrediction.reason,
        cau_phat_hien: lastPrediction.patterns.map(p => p.name).join(", ")
    });
});

router.get('/lichsu', async (req, res) => {
    await updateHistory();
    
    res.json({
        type: 'SicBo Sun',
        history: historyData.slice(0, 20).map(h => ({
            phien: h.gameNum,
            xuc_xac: h.facesList,
            tong: h.score,
            ket_qua: getResultType(h)
        })),
        total: historyData.length
    });
});

router.get('/stats', (req, res) => {
    const predHist = loadPredictionHistory();
    const verified = predHist.filter(p => p.ket_qua_thuc);
    const correct = verified.filter(p => p.du_doan === p.ket_qua_thuc);
    
    res.json({
        total_predictions: predHist.length,
        verified_predictions: verified.length,
        correct_predictions: correct.length,
        accuracy: verified.length > 0 ? ((correct.length / verified.length) * 100).toFixed(2) + '%' : 'N/A',
        recent_predictions: predHist.slice(-10).reverse()
    });
});

router.get('/ls', async (req, res) => {
    await updateHistory();
    
    res.json({
        id: 'API BY BO NHAY DZ',
        type: 'SicBo Sun - Lịch sử gốc',
        total: historyData.length,
        data: historyData.map(h => ({
            phien: h.gameNum,
            xuc_xac: h.facesList,
            tong: h.score,
            ket_qua: getResultType(h)
        }))
    });
});

router.get('/lsdudoan', async (req, res) => {
    await updateHistory();
    updatePredictionResults();
    
    const predHist = loadPredictionHistory();
    const latestPhien = historyData.length > 0 && historyData[0].gameNum 
        ? parseInt(historyData[0].gameNum.replace('#', '')) 
        : 0;
    
    const historyWithStatus = predHist.map(p => {
        let status = '⏳';
        let thucTe = 'Chưa có';
        
        if (p.ket_qua_thuc !== null && p.ket_qua_thuc !== undefined) {
            status = p.du_doan === p.ket_qua_thuc ? '✅' : '❌';
            thucTe = p.ket_qua_thuc;
        } else {
            const predPhien = parseInt(p.phien);
            if (latestPhien > 0 && latestPhien - predPhien > 10) {
                status = '⚠️';
                thucTe = 'Không có dữ liệu';
            }
        }
        
        return {
            phien: p.phien,
            du_doan: p.du_doan,
            thuc_te: thucTe,
            trang_thai: status,
            ti_le: p.do_tin_cay,
            timestamp: p.timestamp
        };
    });
    
    res.json({
        id: 'API BY BO NHAY DZ',
        type: 'SicBo Sun - Lịch sử dự đoán',
        total: historyWithStatus.length,
        data: historyWithStatus
    });
});

async function autoPrediction() {
    try {
        await updateHistory();
        if (historyData.length === 0) return;
        
        const latestSessionData = historyData[0];
        const latestPhien = latestSessionData.gameNum ? latestSessionData.gameNum.replace('#', '') : null;
        if (!latestPhien) return;
        
        const nextPhien = (parseInt(latestPhien) + 1).toString();
        
        if (lastPredictedPhien !== nextPhien) {
            updatePredictionResults();
            
            const result = generateAdvancedPrediction();
            lastPrediction = {
                phien: nextPhien,
                du_doan: result.prediction,
                doan_vi: result.doan_vi,
                do_tin_cay: result.do_tin_cay,
                reason: result.reason,
                patterns: result.patterns
            };
            
            const predHist = loadPredictionHistory();
            predHist.push({
                phien: nextPhien,
                du_doan: result.prediction,
                doan_vi: result.doan_vi,
                do_tin_cay: result.do_tin_cay,
                reason: result.reason,
                patterns: result.patterns.map(p => p.name),
                ket_qua_thuc: null,
                timestamp: Date.now()
            });
            if (predHist.length > 100) predHist.shift();
            savePredictionHistory(predHist);
            
            lastPredictedPhien = nextPhien;
            console.log(`[SicboSun-Auto] Phien ${nextPhien}: ${result.prediction} (${result.do_tin_cay}%)`);
        }
    } catch (error) {
        console.error('[SicboSun-Auto] Error:', error.message);
    }
}

function startAutoPrediction() {
    setInterval(autoPrediction, AUTO_PREDICT_INTERVAL);
    console.log('[SicboSun] Auto-prediction started (every 3s)');
}

loadLearningData();
startAutoPrediction();

module.exports = router;
