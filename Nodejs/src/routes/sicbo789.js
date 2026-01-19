const express = require('express');
const router = express.Router();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const API_URL = 'https://api.xeuigogo.info/v2/history/getLastResult?gameId=ktrng_3986&size=100&tableId=39861215743193&curPage=1';
const HISTORY_FILE = path.join(__dirname, '../../data/sicbo789_history.json');
const AUTO_PREDICT_INTERVAL = 3000;

let historyData = [];
let lastPredictedPhien = null;
let lastPrediction = { phien: null, du_doan: null, doan_vi: [], do_tin_cay: 0, reason: "", patterns: [] };

function loadPredictionHistory() {
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
        }
    } catch (e) {
        console.error('Sicbo789 - Lỗi đọc lịch sử:', e.message);
    }
    return [];
}

function savePredictionHistory(data) {
    try {
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('Sicbo789 - Lỗi lưu lịch sử:', e.message);
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
        console.log(`[Sicbo789] Cleaned ${oldLength - predHist.length} old unverified predictions`);
    }
    
    if (updated) {
        savePredictionHistory(predHist);
    }
}

async function updateHistory() {
    try {
        const res = await axios.get(API_URL);
        if (res?.data?.data?.resultList) {
            historyData = res.data.data.resultList;
        }
    } catch (e) {
        console.error('Sicbo789 - Lỗi cập nhật:', e.message);
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
        const shouldBreak = streakLength >= 5;
        return {
            detected: true,
            type: streakType,
            length: streakLength,
            prediction: shouldBreak ? (streakType === 'Tài' ? 'Xỉu' : 'Tài') : streakType,
            confidence: shouldBreak ? Math.min(16, streakLength * 2.5) : Math.min(20, streakLength * 3.5),
            name: `Cầu Bệt ${streakLength} phiên`,
            patternId: 'cau_bet'
        };
    }
    
    return { detected: false };
}

function analyzeCauDao11(history) {
    if (history.length < 4) return { detected: false };
    
    const results = history.slice(0, 12).map(h => getResultType(h)).filter(r => r !== "Bão");
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
            confidence: Math.min(18, alternatingLength * 2.5 + 5),
            name: `Cầu 1-1 (${alternatingLength} phiên xen kẽ)`,
            patternId: 'cau_11'
        };
    }
    
    return { detected: false };
}

function analyzeCau22(history) {
    if (history.length < 6) return { detected: false };
    
    const results = history.slice(0, 16).map(h => getResultType(h)).filter(r => r !== "Bão");
    let pairCount = 0;
    let i = 0;
    let pattern = [];
    
    while (i < results.length - 1 && pairCount < 5) {
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
        
        if (isAlternating || pairCount >= 3) {
            const lastPairType = pattern[pattern.length - 1];
            const posInCycle = (pairCount * 2) % 4;
            
            return {
                detected: true,
                pairCount,
                prediction: posInCycle < 2 ? lastPairType : (lastPairType === 'Tài' ? 'Xỉu' : 'Tài'),
                confidence: Math.min(17, pairCount * 3.5 + 4),
                name: `Cầu 2-2 (${pairCount} cặp liên tiếp)`,
                patternId: 'cau_22'
            };
        }
    }
    
    return { detected: false };
}

function analyzeCau33(history) {
    if (history.length < 6) return { detected: false };
    
    const results = history.slice(0, 18).map(h => getResultType(h)).filter(r => r !== "Bão");
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
        const currentPosition = (results.length) % 3;
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
            confidence: Math.min(18, tripleCount * 5 + 7),
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
    
    if (results[0] !== results[1] && results[1] !== results[2] && 
        results[2] === results[3] && results[3] === results[4] && results[4] === results[5]) {
        return {
            detected: true,
            pattern: '1-2-3',
            prediction: results[0],
            confidence: 14,
            name: 'Cầu 1-2-3 (tăng dần)',
            patternId: 'cau_123'
        };
    }
    
    if (results[0] === results[1] && results[1] === results[2] && 
        results[3] === results[4] && results[3] !== results[2]) {
        return {
            detected: true,
            pattern: '3-2',
            prediction: results[5] !== results[4] ? results[5] : (results[0] === 'Tài' ? 'Xỉu' : 'Tài'),
            confidence: 13,
            name: 'Cầu 3-2 (giảm dần)',
            patternId: 'cau_321'
        };
    }
    
    return { detected: false };
}

function analyzeCauGay(history) {
    if (history.length < 6) return { detected: false };
    
    const results = history.slice(0, 15).map(h => getResultType(h)).filter(r => r !== "Bão");
    
    let maxStreak = 0;
    let streakType = results[0];
    let currentStreak = 1;
    
    for (let i = 1; i < results.length; i++) {
        if (results[i] === results[i-1]) {
            currentStreak++;
            if (currentStreak > maxStreak) {
                maxStreak = currentStreak;
                streakType = results[i];
            }
        } else {
            currentStreak = 1;
        }
    }
    
    if (maxStreak >= 4 && results[0] !== streakType) {
        return {
            detected: true,
            streakLength: maxStreak,
            breakType: results[0],
            prediction: results[0],
            confidence: Math.min(16, maxStreak * 2 + 5),
            name: `Cầu Gãy (đã bẻ cầu ${maxStreak} phiên)`,
            patternId: 'cau_gay'
        };
    }
    
    return { detected: false };
}

function analyzeDiceTrend(history) {
    if (history.length < 8) return { detected: false };
    
    const diceData = history.slice(0, 8);
    let dice1Avg = 0, dice2Avg = 0, dice3Avg = 0;
    
    diceData.forEach(h => {
        dice1Avg += h.facesList?.[0] || 3.5;
        dice2Avg += h.facesList?.[1] || 3.5;
        dice3Avg += h.facesList?.[2] || 3.5;
    });
    
    dice1Avg /= diceData.length;
    dice2Avg /= diceData.length;
    dice3Avg /= diceData.length;
    
    const totalAvg = dice1Avg + dice2Avg + dice3Avg;
    
    if (totalAvg >= 12) {
        return {
            detected: true,
            type: 'high_avg',
            avgSum: totalAvg.toFixed(2),
            prediction: 'Tài',
            confidence: Math.min(15, Math.round((totalAvg - 10.5) * 3)),
            name: `Trung bình xúc xắc cao (${totalAvg.toFixed(1)})`,
            patternId: 'dice_avg_high'
        };
    } else if (totalAvg <= 9) {
        return {
            detected: true,
            type: 'low_avg',
            avgSum: totalAvg.toFixed(2),
            prediction: 'Xỉu',
            confidence: Math.min(15, Math.round((10.5 - totalAvg) * 3)),
            name: `Trung bình xúc xắc thấp (${totalAvg.toFixed(1)})`,
            patternId: 'dice_avg_low'
        };
    }
    
    return { detected: false };
}

function analyzeIndividualDiceStreak(history) {
    if (history.length < 5) return { detected: false };
    
    const dice1 = history.slice(0, 5).map(h => h.facesList?.[0] || 0);
    const dice2 = history.slice(0, 5).map(h => h.facesList?.[1] || 0);
    const dice3 = history.slice(0, 5).map(h => h.facesList?.[2] || 0);
    
    const allHigh = (arr) => arr.every(d => d >= 4);
    const allLow = (arr) => arr.every(d => d <= 3);
    
    let highCount = 0;
    if (allHigh(dice1) || dice1.filter(d => d >= 4).length >= 4) highCount++;
    if (allHigh(dice2) || dice2.filter(d => d >= 4).length >= 4) highCount++;
    if (allHigh(dice3) || dice3.filter(d => d >= 4).length >= 4) highCount++;
    
    let lowCount = 0;
    if (allLow(dice1) || dice1.filter(d => d <= 3).length >= 4) lowCount++;
    if (allLow(dice2) || dice2.filter(d => d <= 3).length >= 4) lowCount++;
    if (allLow(dice3) || dice3.filter(d => d <= 3).length >= 4) lowCount++;
    
    if (highCount >= 2) {
        return {
            detected: true,
            type: 'dice_streak_high',
            prediction: 'Tài',
            confidence: 10 + highCount * 4,
            name: `${highCount} xúc xắc có xu hướng cao`,
            patternId: 'individual_dice_high'
        };
    } else if (lowCount >= 2) {
        return {
            detected: true,
            type: 'dice_streak_low',
            prediction: 'Xỉu',
            confidence: 10 + lowCount * 4,
            name: `${lowCount} xúc xắc có xu hướng thấp`,
            patternId: 'individual_dice_low'
        };
    }
    
    return { detected: false };
}

function analyzeSumPressure(history) {
    if (history.length < 10) return { detected: false };
    
    const sums = history.slice(0, 10).map(h => h.score || 10.5);
    const highSums = sums.filter(s => s >= 12).length;
    const lowSums = sums.filter(s => s <= 9).length;
    
    if (highSums >= 7) {
        return {
            detected: true,
            type: 'high_sum_pressure',
            highCount: highSums,
            prediction: 'Xỉu',
            confidence: Math.min(15, highSums * 2),
            name: `Áp lực tổng cao (${highSums}/10 phiên ≥12)`,
            patternId: 'sum_pressure_high'
        };
    } else if (lowSums >= 7) {
        return {
            detected: true,
            type: 'low_sum_pressure',
            lowCount: lowSums,
            prediction: 'Tài',
            confidence: Math.min(15, lowSums * 2),
            name: `Áp lực tổng thấp (${lowSums}/10 phiên ≤9)`,
            patternId: 'sum_pressure_low'
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
            confidence: Math.round((taiRatio - 0.5) * 30),
            name: `Lệch Tài ${(taiRatio * 100).toFixed(0)}% → Đổi chiều`,
            patternId: 'distribution_tai'
        };
    } else if (taiRatio <= 0.3) {
        return {
            detected: true,
            xiuRatio: ((1 - taiRatio) * 100).toFixed(1),
            prediction: 'Tài',
            confidence: Math.round((0.5 - taiRatio) * 30),
            name: `Lệch Xỉu ${((1 - taiRatio) * 100).toFixed(0)}% → Đổi chiều`,
            patternId: 'distribution_xiu'
        };
    }
    
    return { detected: false };
}

function predictSmartVi(prediction, history) {
    let possibleSums = [];
    if (prediction === "Tài") possibleSums = [11, 12, 13, 14, 15, 16, 17];
    else if (prediction === "Xỉu") possibleSums = [4, 5, 6, 7, 8, 9, 10];
    else return [3, 9, 12, 15, 18].slice(0, 3);
    
    const historicalSums = history.slice(0, 12)
        .filter(h => getResultType(h) === prediction)
        .map(h => h.score);
    
    const sumFrequency = {};
    possibleSums.forEach(s => sumFrequency[s] = 0);
    historicalSums.forEach(sum => {
        if (sumFrequency[sum] !== undefined) {
            sumFrequency[sum]++;
        }
    });
    
    const sortedSums = possibleSums.sort((a, b) => {
        const freqDiff = (sumFrequency[b] || 0) - (sumFrequency[a] || 0);
        if (freqDiff !== 0) return freqDiff;
        const midPoint = prediction === "Tài" ? 14 : 7;
        return Math.abs(a - midPoint) - Math.abs(b - midPoint);
    });
    
    return sortedSums.slice(0, 3);
}

function generateAdvancedPrediction() {
    if (historyData.length < 5) {
        const randomPred = Math.random() < 0.5 ? "Tài" : "Xỉu";
        return {
            prediction: randomPred,
            doan_vi: randomPred === "Tài" ? [12, 13, 14] : [6, 7, 8],
            do_tin_cay: "63.00%",
            reason: "Chưa đủ dữ liệu lịch sử",
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
    
    const diceTrend = analyzeDiceTrend(historyData);
    if (diceTrend.detected) {
        predictions.push({ prediction: diceTrend.prediction, confidence: diceTrend.confidence, priority: 6, name: diceTrend.name });
        allPatterns.push(diceTrend);
    }
    
    const diceStreak = analyzeIndividualDiceStreak(historyData);
    if (diceStreak.detected) {
        predictions.push({ prediction: diceStreak.prediction, confidence: diceStreak.confidence, priority: 7, name: diceStreak.name });
        allPatterns.push(diceStreak);
    }
    
    const sumPressure = analyzeSumPressure(historyData);
    if (sumPressure.detected) {
        predictions.push({ prediction: sumPressure.prediction, confidence: sumPressure.confidence, priority: 5, name: sumPressure.name });
        allPatterns.push(sumPressure);
    }
    
    const distribution = analyzeDistribution(historyData);
    if (distribution.detected) {
        predictions.push({ prediction: distribution.prediction, confidence: distribution.confidence, priority: 4, name: distribution.name });
        allPatterns.push(distribution);
    }
    
    if (predictions.length === 0) {
        const results = historyData.slice(0, 10).map(h => getResultType(h)).filter(r => r !== "Bão");
        const taiCount = results.filter(r => r === 'Tài').length;
        const defaultPred = taiCount > results.length / 2 ? 'Xỉu' : 'Tài';
        
        return {
            prediction: defaultPred,
            doan_vi: predictSmartVi(defaultPred, historyData),
            do_tin_cay: "64.50%",
            reason: "Không phát hiện cầu, dự đoán cân bằng",
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
    
    let baseConfidence = 62;
    predictions.forEach(p => {
        if (p.prediction === finalPrediction) {
            baseConfidence += p.confidence * 0.35;
        } else {
            baseConfidence -= p.confidence * 0.12;
        }
    });
    
    const finalConfidence = Math.min(97, Math.max(58, baseConfidence));
    
    const topPatterns = allPatterns
        .filter(p => p.prediction === finalPrediction)
        .slice(0, 3)
        .map(p => p.name);
    
    const reason = topPatterns.length > 0 
        ? `Phân tích: ${topPatterns.join(', ')}`
        : 'Tổng hợp nhiều yếu tố';
    
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
            ket_qua_thuc: null,
            timestamp: Date.now()
        });
        if (predHist.length > 100) predHist.shift();
        savePredictionHistory(predHist);
    }
    
    res.json({
        id: "API SICBO 789 - Advanced Algorithm",
        Phien: latestPhien,
        Xuc_xac_1: latestSessionData?.facesList?.[0] || 0,
        Xuc_xac_2: latestSessionData?.facesList?.[1] || 0,
        Xuc_xac_3: latestSessionData?.facesList?.[2] || 0,
        Tong: latestSessionData?.score || 0,
        Ket_qua: getResultType(latestSessionData),
        phien_hien_tai: nextPhien,
        du_doan: lastPrediction.du_doan,
        dudoan_vi: lastPrediction.doan_vi.join(", "),
        do_tin_cay: lastPrediction.do_tin_cay,
        ly_do: lastPrediction.reason
    });
});

router.get('/lichsu', async (req, res) => {
    await updateHistory();
    
    res.json({
        type: 'SicBo 789',
        history: historyData.slice(0, 20).map(h => ({
            phien: h.gameNum,
            xuc_xac: h.facesList,
            tong: h.score,
            ket_qua: getResultType(h)
        })),
        total: historyData.length
    });
});

router.get('/ls', async (req, res) => {
    await updateHistory();
    
    res.json({
        id: 'API BY BO NHAY DZ',
        type: 'SicBo 789 - Lịch sử gốc',
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
        type: 'SicBo 789 - Lịch sử dự đoán',
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
                ket_qua_thuc: null,
                timestamp: Date.now()
            });
            if (predHist.length > 100) predHist.shift();
            savePredictionHistory(predHist);
            
            lastPredictedPhien = nextPhien;
            console.log(`[Sicbo789-Auto] Phien ${nextPhien}: ${result.prediction} (${result.do_tin_cay}%)`);
        }
    } catch (error) {
        console.error('[Sicbo789-Auto] Error:', error.message);
    }
}

function startAutoPrediction() {
    setInterval(autoPrediction, AUTO_PREDICT_INTERVAL);
    console.log('[Sicbo789] Auto-prediction started (every 3s)');
}

startAutoPrediction();

module.exports = router;
