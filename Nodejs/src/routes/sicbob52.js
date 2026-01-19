const express = require('express');
const router = express.Router();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const API_URL = 'https://api.wsmt8g.cc/v2/history/getLastResult?gameId=ktrng_3996&size=100&tableId=39961215743193&curPage=1';
const HISTORY_FILE = path.join(__dirname, '../../data/sicbob52_history.json');
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
        console.error('SicboB52 - Lỗi đọc lịch sử:', e.message);
    }
    return [];
}

function savePredictionHistory(data) {
    try {
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('SicboB52 - Lỗi lưu lịch sử:', e.message);
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
        console.log(`[SicboB52] Cleaned ${oldLength - predHist.length} old unverified predictions`);
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
        console.error('SicboB52 - Lỗi cập nhật:', e.message);
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
    
    const results = history.slice(0, 25).map(h => getResultType(h));
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
        const shouldBreak = streakLength >= 7;
        return {
            detected: true,
            type: streakType,
            length: streakLength,
            prediction: shouldBreak ? (streakType === 'Tài' ? 'Xỉu' : 'Tài') : streakType,
            confidence: shouldBreak ? Math.min(18, streakLength * 2) : Math.min(22, streakLength * 3),
            name: `Cầu Bệt ${streakLength} phiên liên tiếp`,
            patternId: 'cau_bet'
        };
    }
    
    return { detected: false };
}

function analyzeCauDao11(history) {
    if (history.length < 4) return { detected: false };
    
    const results = history.slice(0, 14).map(h => getResultType(h)).filter(r => r !== "Bão");
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
            confidence: Math.min(20, alternatingLength * 3 + 4),
            name: `Cầu Đảo 1-1 (${alternatingLength} lần đổi)`,
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
    
    while (i < results.length - 1 && pairCount < 6) {
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
            const nextInCycle = lastPairType === 'Tài' ? 'Xỉu' : 'Tài';
            
            return {
                detected: true,
                pairCount,
                prediction: nextInCycle,
                confidence: Math.min(19, pairCount * 4 + 3),
                name: `Cầu 2-2 (${pairCount} cặp đôi)`,
                patternId: 'cau_22'
            };
        }
    }
    
    return { detected: false };
}

function analyzeCau33(history) {
    if (history.length < 6) return { detected: false };
    
    const results = history.slice(0, 21).map(h => getResultType(h)).filter(r => r !== "Bão");
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
        const positionInTriple = results.length % 3;
        const lastTripleType = pattern[pattern.length - 1];
        
        let prediction;
        if (positionInTriple === 0) {
            prediction = lastTripleType === 'Tài' ? 'Xỉu' : 'Tài';
        } else {
            prediction = lastTripleType;
        }
        
        return {
            detected: true,
            tripleCount,
            positionInTriple,
            prediction,
            confidence: Math.min(20, tripleCount * 5 + 8),
            name: `Cầu 3-3 (${tripleCount} bộ ba, vị trí ${positionInTriple + 1}/3)`,
            patternId: 'cau_33'
        };
    }
    
    return { detected: false };
}

function analyzeCau123(history) {
    if (history.length < 6) return { detected: false };
    
    const results = history.slice(0, 12).map(h => getResultType(h)).filter(r => r !== "Bão");
    if (results.length < 6) return { detected: false };
    
    const slice6 = results.slice(0, 6);
    
    if (slice6[5] !== slice6[4] && slice6[4] !== slice6[3] && 
        slice6[3] === slice6[2] && slice6[2] === slice6[1] && slice6[1] !== slice6[0]) {
        return {
            detected: true,
            pattern: '1-2-3-mix',
            prediction: slice6[0],
            confidence: 15,
            name: 'Cầu 1-2-3 biến thể',
            patternId: 'cau_123'
        };
    }
    
    return { detected: false };
}

function analyzeCauGay(history) {
    if (history.length < 6) return { detected: false };
    
    const results = history.slice(0, 18).map(h => getResultType(h)).filter(r => r !== "Bão");
    
    let streakLength = 1;
    for (let i = 1; i < results.length; i++) {
        if (results[i] === results[0]) {
            streakLength++;
        } else {
            break;
        }
    }
    
    if (streakLength >= 5) {
        return {
            detected: true,
            streakLength,
            prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
            confidence: Math.min(17, streakLength * 2 + 4),
            name: `Cầu Bẻ (chuỗi ${streakLength} phiên sắp gãy)`,
            patternId: 'cau_gay'
        };
    }
    
    return { detected: false };
}

function analyzeDiceMomentum(history) {
    if (history.length < 6) return { detected: false };
    
    const recent = history.slice(0, 6);
    let totalSum = 0;
    let trend = [];
    
    recent.forEach((h, idx) => {
        const sum = h.score || 10.5;
        totalSum += sum;
        if (idx > 0) {
            const prevSum = recent[idx - 1].score || 10.5;
            trend.push(sum > prevSum ? 1 : sum < prevSum ? -1 : 0);
        }
    });
    
    const avgSum = totalSum / recent.length;
    const upTrend = trend.filter(t => t > 0).length;
    const downTrend = trend.filter(t => t < 0).length;
    
    if (upTrend >= 4 && avgSum >= 11) {
        return {
            detected: true,
            type: 'rising_momentum',
            avgSum: avgSum.toFixed(2),
            prediction: 'Tài',
            confidence: Math.min(16, upTrend * 3 + 4),
            name: `Momentum tăng (${upTrend}/5 lần tăng)`,
            patternId: 'dice_momentum_up'
        };
    } else if (downTrend >= 4 && avgSum <= 10) {
        return {
            detected: true,
            type: 'falling_momentum',
            avgSum: avgSum.toFixed(2),
            prediction: 'Xỉu',
            confidence: Math.min(16, downTrend * 3 + 4),
            name: `Momentum giảm (${downTrend}/5 lần giảm)`,
            patternId: 'dice_momentum_down'
        };
    }
    
    return { detected: false };
}

function analyzeIndividualDicePattern(history) {
    if (history.length < 8) return { detected: false };
    
    const dice1 = history.slice(0, 8).map(h => h.facesList?.[0] || 0);
    const dice2 = history.slice(0, 8).map(h => h.facesList?.[1] || 0);
    const dice3 = history.slice(0, 8).map(h => h.facesList?.[2] || 0);
    
    const checkStreak = (arr) => {
        let highStreak = 0, lowStreak = 0;
        arr.forEach(d => {
            if (d >= 4) highStreak++;
            else lowStreak++;
        });
        return { highStreak, lowStreak };
    };
    
    const d1Stats = checkStreak(dice1);
    const d2Stats = checkStreak(dice2);
    const d3Stats = checkStreak(dice3);
    
    const totalHigh = d1Stats.highStreak + d2Stats.highStreak + d3Stats.highStreak;
    const totalLow = d1Stats.lowStreak + d2Stats.lowStreak + d3Stats.lowStreak;
    
    if (totalHigh >= 18) {
        return {
            detected: true,
            type: 'triple_high_dice',
            prediction: 'Tài',
            confidence: Math.min(17, Math.round(totalHigh / 24 * 20)),
            name: `Xúc xắc nghiêng cao (${totalHigh}/24)`,
            patternId: 'triple_dice_high'
        };
    } else if (totalLow >= 18) {
        return {
            detected: true,
            type: 'triple_low_dice',
            prediction: 'Xỉu',
            confidence: Math.min(17, Math.round(totalLow / 24 * 20)),
            name: `Xúc xắc nghiêng thấp (${totalLow}/24)`,
            patternId: 'triple_dice_low'
        };
    }
    
    return { detected: false };
}

function analyzeSumVolatility(history) {
    if (history.length < 10) return { detected: false };
    
    const sums = history.slice(0, 10).map(h => h.score || 10.5);
    const avg = sums.reduce((a, b) => a + b, 0) / sums.length;
    
    let variance = 0;
    sums.forEach(s => variance += Math.pow(s - avg, 2));
    variance /= sums.length;
    const stdDev = Math.sqrt(variance);
    
    if (stdDev <= 1.5 && avg >= 11.5) {
        return {
            detected: true,
            type: 'stable_high',
            avgSum: avg.toFixed(2),
            stdDev: stdDev.toFixed(2),
            prediction: 'Tài',
            confidence: Math.min(15, Math.round((11.5 - stdDev) * 5)),
            name: `Ổn định vùng cao (TB=${avg.toFixed(1)})`,
            patternId: 'stable_high'
        };
    } else if (stdDev <= 1.5 && avg <= 9.5) {
        return {
            detected: true,
            type: 'stable_low',
            avgSum: avg.toFixed(2),
            stdDev: stdDev.toFixed(2),
            prediction: 'Xỉu',
            confidence: Math.min(15, Math.round((11.5 - stdDev) * 5)),
            name: `Ổn định vùng thấp (TB=${avg.toFixed(1)})`,
            patternId: 'stable_low'
        };
    }
    
    return { detected: false };
}

function analyzeDistribution(history) {
    if (history.length < 18) return { detected: false };
    
    const results = history.slice(0, 25).map(h => getResultType(h));
    const taiCount = results.filter(r => r === 'Tài').length;
    const xiuCount = results.filter(r => r === 'Xỉu').length;
    const total = taiCount + xiuCount;
    
    if (total === 0) return { detected: false };
    
    const taiRatio = taiCount / total;
    
    if (taiRatio >= 0.68) {
        return {
            detected: true,
            taiCount,
            xiuCount,
            prediction: 'Xỉu',
            confidence: Math.round((taiRatio - 0.5) * 35),
            name: `Phân phối lệch Tài ${(taiRatio * 100).toFixed(0)}%`,
            patternId: 'distribution_tai'
        };
    } else if (taiRatio <= 0.32) {
        return {
            detected: true,
            taiCount,
            xiuCount,
            prediction: 'Tài',
            confidence: Math.round((0.5 - taiRatio) * 35),
            name: `Phân phối lệch Xỉu ${((1 - taiRatio) * 100).toFixed(0)}%`,
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
    
    const historicalSums = history.slice(0, 15)
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
            doan_vi: randomPred === "Tài" ? [11, 13, 14] : [6, 7, 9],
            do_tin_cay: "61.00%",
            reason: "Chưa đủ dữ liệu phân tích",
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
    
    const diceMomentum = analyzeDiceMomentum(historyData);
    if (diceMomentum.detected) {
        predictions.push({ prediction: diceMomentum.prediction, confidence: diceMomentum.confidence, priority: 7, name: diceMomentum.name });
        allPatterns.push(diceMomentum);
    }
    
    const dicePattern = analyzeIndividualDicePattern(historyData);
    if (dicePattern.detected) {
        predictions.push({ prediction: dicePattern.prediction, confidence: dicePattern.confidence, priority: 6, name: dicePattern.name });
        allPatterns.push(dicePattern);
    }
    
    const sumVolatility = analyzeSumVolatility(historyData);
    if (sumVolatility.detected) {
        predictions.push({ prediction: sumVolatility.prediction, confidence: sumVolatility.confidence, priority: 5, name: sumVolatility.name });
        allPatterns.push(sumVolatility);
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
            do_tin_cay: "63.50%",
            reason: "Dự đoán cân bằng xác suất",
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
    
    let baseConfidence = 61;
    predictions.forEach(p => {
        if (p.prediction === finalPrediction) {
            baseConfidence += p.confidence * 0.38;
        } else {
            baseConfidence -= p.confidence * 0.1;
        }
    });
    
    const finalConfidence = Math.min(97.5, Math.max(56, baseConfidence));
    
    const topPatterns = allPatterns
        .filter(p => p.prediction === finalPrediction)
        .slice(0, 3)
        .map(p => p.name);
    
    const reason = topPatterns.length > 0 
        ? `Dựa vào: ${topPatterns.join(', ')}`
        : 'Phân tích tổng hợp';
    
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
        id: "API SICBO B52 - Advanced Algorithm",
        Phien: latestPhien || "",
        Xuc_xac_1: latestSessionData?.facesList?.[0] || 0,
        Xuc_xac_2: latestSessionData?.facesList?.[1] || 0,
        Xuc_xac_3: latestSessionData?.facesList?.[2] || 0,
        Tong: latestSessionData?.score || 0,
        Ket_qua: getResultType(latestSessionData) || "",
        phien_hien_tai: nextPhien || "",
        du_doan: lastPrediction.du_doan || "",
        dudoan_vi: lastPrediction.doan_vi.join(", ") || "",
        do_tin_cay: lastPrediction.do_tin_cay,
        ly_do: lastPrediction.reason
    });
});

router.get('/lichsu', async (req, res) => {
    await updateHistory();
    
    res.json({
        type: 'SicBo B52',
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
        type: 'SicBo B52 - Lịch sử gốc',
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
        type: 'SicBo B52 - Lịch sử dự đoán',
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
            console.log(`[SicboB52-Auto] Phien ${nextPhien}: ${result.prediction} (${result.do_tin_cay}%)`);
        }
    } catch (error) {
        console.error('[SicboB52-Auto] Error:', error.message);
    }
}

function startAutoPrediction() {
    setInterval(autoPrediction, AUTO_PREDICT_INTERVAL);
    console.log('[SicboB52] Auto-prediction started (every 3s)');
}

startAutoPrediction();

module.exports = router;
