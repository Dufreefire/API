const express = require('express');
const router = express.Router();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const API_URL = 'https://api.wsmt8g.cc/v2/history/getLastResult?gameId=ktrng_3932&size=120&tableId=39321215743193&curPage=1';
const HISTORY_FILE = path.join(__dirname, '../../data/sicbohit_history.json');
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
        console.error('SicboHit - Lỗi đọc lịch sử:', e.message);
    }
    return [];
}

function savePredictionHistory(data) {
    try {
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('SicboHit - Lỗi lưu lịch sử:', e.message);
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
        console.log(`[SicboHit] Cleaned ${oldLength - predHist.length} old unverified predictions`);
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
        console.error('SicboHit - Lỗi cập nhật:', e.message);
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
    
    const results = history.slice(0, 22).map(h => getResultType(h));
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
            confidence: shouldBreak ? Math.min(17, streakLength * 2.2) : Math.min(21, streakLength * 3.2),
            name: `Cầu Bệt ${streakType} ${streakLength} phiên`,
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
            confidence: Math.min(19, alternatingLength * 2.8 + 5),
            name: `Cầu 1-1 xen kẽ (${alternatingLength} phiên)`,
            patternId: 'cau_11'
        };
    }
    
    return { detected: false };
}

function analyzeCau22(history) {
    if (history.length < 6) return { detected: false };
    
    const results = history.slice(0, 18).map(h => getResultType(h)).filter(r => r !== "Bão");
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
            const positionInPair = results.length % 2;
            
            return {
                detected: true,
                pairCount,
                prediction: positionInPair === 0 ? (lastPairType === 'Tài' ? 'Xỉu' : 'Tài') : lastPairType,
                confidence: Math.min(18, pairCount * 3.8 + 4),
                name: `Cầu 2-2 (${pairCount} cặp đối xứng)`,
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
            currentPosition,
            prediction,
            confidence: Math.min(19, tripleCount * 5.5 + 7),
            name: `Cầu 3-3 (${tripleCount} bộ, vị trí ${currentPosition + 1})`,
            patternId: 'cau_33'
        };
    }
    
    return { detected: false };
}

function analyzeCau123(history) {
    if (history.length < 6) return { detected: false };
    
    const results = history.slice(0, 10).map(h => getResultType(h)).filter(r => r !== "Bão");
    if (results.length < 6) return { detected: false };
    
    const recent6 = results.slice(0, 6);
    const counts = { single: 0, double: 0, triple: 0 };
    
    let i = 0;
    while (i < recent6.length) {
        let runLength = 1;
        while (i + runLength < recent6.length && recent6[i] === recent6[i + runLength]) {
            runLength++;
        }
        if (runLength === 1) counts.single++;
        else if (runLength === 2) counts.double++;
        else if (runLength >= 3) counts.triple++;
        i += runLength;
    }
    
    if (counts.single >= 1 && counts.double >= 1 && counts.triple >= 1) {
        return {
            detected: true,
            pattern: '1-2-3 mixed',
            prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
            confidence: 14,
            name: 'Cầu 1-2-3 hỗn hợp',
            patternId: 'cau_123_mix'
        };
    }
    
    return { detected: false };
}

function analyzeCauGay(history) {
    if (history.length < 6) return { detected: false };
    
    const results = history.slice(0, 16).map(h => getResultType(h)).filter(r => r !== "Bão");
    
    let prevStreak = 0;
    let prevStreakType = null;
    
    for (let i = 1; i < results.length; i++) {
        if (results[i] === results[1]) {
            prevStreak++;
            prevStreakType = results[1];
        } else if (prevStreak === 0) {
            continue;
        } else {
            break;
        }
    }
    
    if (prevStreak >= 4 && results[0] !== prevStreakType) {
        return {
            detected: true,
            streakLength: prevStreak,
            breakType: results[0],
            prediction: results[0],
            confidence: Math.min(16, prevStreak * 2.5 + 4),
            name: `Cầu Gãy (vừa bẻ cầu ${prevStreak} phiên)`,
            patternId: 'cau_gay'
        };
    }
    
    return { detected: false };
}

function analyzeDiceHotCold(history) {
    if (history.length < 8) return { detected: false };
    
    const dice1 = history.slice(0, 8).map(h => h.facesList?.[0] || 0);
    const dice2 = history.slice(0, 8).map(h => h.facesList?.[1] || 0);
    const dice3 = history.slice(0, 8).map(h => h.facesList?.[2] || 0);
    
    const hot = [5, 6];
    const cold = [1, 2];
    
    let hotCount = 0, coldCount = 0;
    
    [dice1, dice2, dice3].forEach(arr => {
        arr.forEach(d => {
            if (hot.includes(d)) hotCount++;
            if (cold.includes(d)) coldCount++;
        });
    });
    
    if (hotCount >= 14) {
        return {
            detected: true,
            type: 'hot_dice',
            hotCount,
            prediction: 'Tài',
            confidence: Math.min(16, Math.round(hotCount / 24 * 22)),
            name: `Xúc xắc nóng (${hotCount}/24 số 5-6)`,
            patternId: 'dice_hot'
        };
    } else if (coldCount >= 14) {
        return {
            detected: true,
            type: 'cold_dice',
            coldCount,
            prediction: 'Xỉu',
            confidence: Math.min(16, Math.round(coldCount / 24 * 22)),
            name: `Xúc xắc lạnh (${coldCount}/24 số 1-2)`,
            patternId: 'dice_cold'
        };
    }
    
    return { detected: false };
}

function analyzeIndividualDiceBalance(history) {
    if (history.length < 10) return { detected: false };
    
    const recent = history.slice(0, 10);
    let dice1Sum = 0, dice2Sum = 0, dice3Sum = 0;
    
    recent.forEach(h => {
        dice1Sum += h.facesList?.[0] || 3.5;
        dice2Sum += h.facesList?.[1] || 3.5;
        dice3Sum += h.facesList?.[2] || 3.5;
    });
    
    const avg1 = dice1Sum / 10;
    const avg2 = dice2Sum / 10;
    const avg3 = dice3Sum / 10;
    
    const highDice = [avg1, avg2, avg3].filter(a => a >= 4).length;
    const lowDice = [avg1, avg2, avg3].filter(a => a <= 3).length;
    
    if (highDice === 3) {
        return {
            detected: true,
            type: 'all_high_avg',
            avgs: [avg1.toFixed(2), avg2.toFixed(2), avg3.toFixed(2)],
            prediction: 'Tài',
            confidence: 15,
            name: `3 xúc xắc đều cao (TB: ${avg1.toFixed(1)}, ${avg2.toFixed(1)}, ${avg3.toFixed(1)})`,
            patternId: 'dice_all_high'
        };
    } else if (lowDice === 3) {
        return {
            detected: true,
            type: 'all_low_avg',
            avgs: [avg1.toFixed(2), avg2.toFixed(2), avg3.toFixed(2)],
            prediction: 'Xỉu',
            confidence: 15,
            name: `3 xúc xắc đều thấp (TB: ${avg1.toFixed(1)}, ${avg2.toFixed(1)}, ${avg3.toFixed(1)})`,
            patternId: 'dice_all_low'
        };
    }
    
    return { detected: false };
}

function analyzeSumResistance(history) {
    if (history.length < 12) return { detected: false };
    
    const sums = history.slice(0, 12).map(h => h.score || 10.5);
    const boundaries = sums.filter(s => s === 10 || s === 11).length;
    const highSums = sums.filter(s => s >= 13).length;
    const lowSums = sums.filter(s => s <= 8).length;
    
    if (boundaries >= 6) {
        const last3Avg = (sums[0] + sums[1] + sums[2]) / 3;
        return {
            detected: true,
            type: 'boundary_zone',
            prediction: last3Avg >= 10.5 ? 'Tài' : 'Xỉu',
            confidence: 12,
            name: `Vùng biên nhiều (${boundaries}/12 phiên 10-11)`,
            patternId: 'sum_boundary'
        };
    } else if (highSums >= 7) {
        return {
            detected: true,
            type: 'high_resistance',
            prediction: 'Xỉu',
            confidence: Math.min(14, highSums * 2),
            name: `Kháng cự vùng cao (${highSums}/12 ≥13)`,
            patternId: 'sum_resistance_high'
        };
    } else if (lowSums >= 7) {
        return {
            detected: true,
            type: 'low_support',
            prediction: 'Tài',
            confidence: Math.min(14, lowSums * 2),
            name: `Hỗ trợ vùng thấp (${lowSums}/12 ≤8)`,
            patternId: 'sum_support_low'
        };
    }
    
    return { detected: false };
}

function analyzeDistribution(history) {
    if (history.length < 16) return { detected: false };
    
    const results = history.slice(0, 22).map(h => getResultType(h));
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
            confidence: Math.round((taiRatio - 0.5) * 32),
            name: `Phân bố lệch Tài ${(taiRatio * 100).toFixed(0)}%`,
            patternId: 'distribution_tai'
        };
    } else if (taiRatio <= 0.32) {
        return {
            detected: true,
            taiCount,
            xiuCount,
            prediction: 'Tài',
            confidence: Math.round((0.5 - taiRatio) * 32),
            name: `Phân bố lệch Xỉu ${((1 - taiRatio) * 100).toFixed(0)}%`,
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
    
    const historicalSums = history.slice(0, 14)
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
            do_tin_cay: "62.50%",
            reason: "Chưa đủ dữ liệu phân tích chuyên sâu",
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
    
    const diceHotCold = analyzeDiceHotCold(historyData);
    if (diceHotCold.detected) {
        predictions.push({ prediction: diceHotCold.prediction, confidence: diceHotCold.confidence, priority: 7, name: diceHotCold.name });
        allPatterns.push(diceHotCold);
    }
    
    const diceBalance = analyzeIndividualDiceBalance(historyData);
    if (diceBalance.detected) {
        predictions.push({ prediction: diceBalance.prediction, confidence: diceBalance.confidence, priority: 6, name: diceBalance.name });
        allPatterns.push(diceBalance);
    }
    
    const sumResistance = analyzeSumResistance(historyData);
    if (sumResistance.detected) {
        predictions.push({ prediction: sumResistance.prediction, confidence: sumResistance.confidence, priority: 5, name: sumResistance.name });
        allPatterns.push(sumResistance);
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
            do_tin_cay: "64.00%",
            reason: "Không phát hiện cầu rõ, dự đoán cân bằng",
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
            baseConfidence += p.confidence * 0.36;
        } else {
            baseConfidence -= p.confidence * 0.11;
        }
    });
    
    const finalConfidence = Math.min(97.5, Math.max(57, baseConfidence));
    
    const topPatterns = allPatterns
        .filter(p => p.prediction === finalPrediction)
        .slice(0, 3)
        .map(p => p.name);
    
    const reason = topPatterns.length > 0 
        ? `Phân tích: ${topPatterns.join(', ')}`
        : 'Tổng hợp đa yếu tố';
    
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
    
    const latest = historyData[0] || {};
    const currentPhien = latest.gameNum;
    
    if (!currentPhien) {
        return res.status(503).json({ error: "Không thể lấy dữ liệu lịch sử, vui lòng thử lại." });
    }
    
    const phienNumber = parseInt(currentPhien.replace('#', ''));
    const nextPhien = (phienNumber + 1).toString();
    
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
        id: "API SICBO HIT - Advanced Algorithm",
        Phien: phienNumber,
        Xuc_xac_1: latest.facesList?.[0] || 0,
        Xuc_xac_2: latest.facesList?.[1] || 0,
        Xuc_xac_3: latest.facesList?.[2] || 0,
        Tong: latest.score || 0,
        Ket_qua: getResultType(latest) || "Chờ kết quả...",
        phien_hien_tai: nextPhien,
        du_doan: lastPrediction.du_doan || "Đang chờ...",
        dudoan_vi: lastPrediction.doan_vi ? lastPrediction.doan_vi.join(', ') : "",
        do_tin_cay: lastPrediction.do_tin_cay,
        ly_do: lastPrediction.reason
    });
});

router.get('/lichsu', async (req, res) => {
    await updateHistory();
    
    res.json({
        type: 'SicBo Hit',
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
        type: 'SicBo Hit - Lịch sử gốc',
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
        type: 'SicBo Hit - Lịch sử dự đoán',
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
            console.log(`[SicboHit-Auto] Phien ${nextPhien}: ${result.prediction} (${result.do_tin_cay}%)`);
        }
    } catch (error) {
        console.error('[SicboHit-Auto] Error:', error.message);
    }
}

function startAutoPrediction() {
    setInterval(autoPrediction, AUTO_PREDICT_INTERVAL);
    console.log('[SicboHit] Auto-prediction started (every 3s)');
}

startAutoPrediction();

module.exports = router;
