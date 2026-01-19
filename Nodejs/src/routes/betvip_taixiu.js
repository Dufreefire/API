const express = require('express');
const router = express.Router();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { generateAIPrediction, updateGameLearning, getGameStats } = require('../core/GameAIFactory');

const API_URL = "https://wtx.macminim6.online/v1/tx/lite-sessions?cp=R&cl=R&pf=web&at=d33e97261b2b18149cf3fe926fb01501";
const MAX_HISTORY_SIZE = 100;
const AUTO_PREDICT_INTERVAL = 3000;
let lastPredictedPhien = null;

const HISTORY_DIR = path.join(__dirname, '../data/history');
const PREDICTION_HISTORY_FILE = path.join(HISTORY_DIR, 'prediction_history_betvip_taixiu.json');
const EXTERNAL_HISTORY_FILE = path.join(HISTORY_DIR, 'external_history_betvip_taixiu.json');

if (!fs.existsSync(HISTORY_DIR)) {
    fs.mkdirSync(HISTORY_DIR, { recursive: true });
}

let historyList = [];
let cachedRaw = null;
let lastSid = null;

let learningData = {
    predictions: [],
    totalPredictions: 0,
    correctPredictions: 0,
    streakAnalysis: { wins: 0, losses: 0, currentStreak: 0 },
    lastUpdate: null
};

function loadExternalHistory() {
    try {
        if (fs.existsSync(EXTERNAL_HISTORY_FILE)) {
            const data = fs.readFileSync(EXTERNAL_HISTORY_FILE, 'utf8');
            historyList = JSON.parse(data);
            console.log(`[Betvip-TaiXiu] External history loaded: ${historyList.length} records`);
        }
    } catch (error) {
        console.error('[Betvip-TaiXiu] Error loading external history:', error.message);
    }
}

function saveExternalHistory() {
    try {
        fs.writeFileSync(EXTERNAL_HISTORY_FILE, JSON.stringify(historyList, null, 2));
    } catch (error) {
        console.error('[Betvip-TaiXiu] Error saving external history:', error.message);
    }
}

function imbalanceBreaker(history) {
    if (!history || history.length < 10) return 0;
    const last10 = history.slice(0, 10).map(h => h.Ket_qua);
    const taiCount = last10.filter(r => r === 'Tài').length;
    const xiuCount = 10 - taiCount;
    if (taiCount >= 7) return 2;
    if (xiuCount >= 7) return 1;
    return 0;
}

function loadPredictionHistory() {
    try {
        if (fs.existsSync(PREDICTION_HISTORY_FILE)) {
            const data = fs.readFileSync(PREDICTION_HISTORY_FILE, 'utf8');
            const parsed = JSON.parse(data);
            learningData = { ...learningData, ...parsed };
            console.log('[Betvip-TaiXiu] Prediction history loaded successfully');
        }
    } catch (error) {
        console.error('[Betvip-TaiXiu] Error loading prediction history:', error.message);
    }
}

function savePredictionHistory() {
    try {
        fs.writeFileSync(PREDICTION_HISTORY_FILE, JSON.stringify(learningData, null, 2));
    } catch (error) {
        console.error('[Betvip-TaiXiu] Error saving prediction history:', error.message);
    }
}

function getTaiXiu(sumDice) {
    return sumDice <= 10 ? "Xỉu" : "Tài";
}

function parseRawData(rawDataList) {
    const parsedList = [];
    if (!Array.isArray(rawDataList)) return [];
    for (const item of rawDataList) {
        if (item.id && item.dices && item.point) {
            if (!Array.isArray(item.dices) || item.dices.length < 3) continue;
            parsedList.push({
                Phien: item.id,
                sid: item.id,
                Xuc_xac_1: item.dices[0],
                Xuc_xac_2: item.dices[1],
                Xuc_xac_3: item.dices[2],
                Tong: item.point,
                Ket_qua: getTaiXiu(item.point)
            });
        }
    }
    return parsedList;
}

function detectStreakAndBreak(history) {
    if (!history.length) return { streak: 0, currentResult: null, breakProb: 0.0 };
    let streak = 1;
    const currentResult = history[0].Ket_qua;
    for (let i = 1; i < history.length; i++) {
        if (history[i].Ket_qua === currentResult) streak++;
        else break;
    }
    const last15 = history.slice(0, 15).map(h => h.Ket_qua);
    if (!last15.length) return { streak, currentResult, breakProb: 0.0 };
    let switches = 0;
    for (let i = 1; i < last15.length; i++) {
        if (last15[i] !== last15[i - 1]) switches++;
    }
    const taiCount = last15.filter(r => r === 'Tài').length;
    const xiuCount = last15.length - taiCount;
    const imbalance = Math.abs(taiCount - xiuCount) / last15.length;
    let breakProb = 0.0;
    if (streak >= 7) breakProb = Math.min(0.9 + imbalance * 0.4, 0.98);
    else if (streak >= 5) breakProb = Math.min(0.75 + imbalance * 0.3, 0.95);
    else if (streak >= 3) breakProb = Math.min(0.4 + imbalance * 0.2, 0.8);
    else if (streak === 1 && switches >= 6) breakProb = 0.55;
    return { streak, currentResult, breakProb };
}

function smartBridgeBreak(history) {
    if (!history.length || history.length < 5) return { prediction: 0, breakProb: 0.0, reason: 'Không đủ dữ liệu' };
    const streakInfo = detectStreakAndBreak(history);
    const { streak, currentResult, breakProb } = streakInfo;
    let prediction = 0;
    let reason = '';
    if (breakProb > 0.7) {
        prediction = currentResult === 'Tài' ? 2 : 1;
        reason = `[SBB Bẻ Mạnh] Xác suất bẻ cầu rất cao (${breakProb.toFixed(2)}), dự đoán bẻ`;
    } else if (streak >= 5 && breakProb < 0.5) {
        prediction = currentResult === 'Tài' ? 1 : 2;
        reason = `[SBB Theo Mạnh] Chuỗi ${currentResult} mạnh (${streak} lần), tiếp tục theo cầu`;
    } else {
        prediction = currentResult === 'Tài' ? 2 : 1;
        reason = `[SBB Default] Không có mẫu rõ ràng, dự đoán bẻ nhẹ (1-1)`;
    }
    return { prediction, breakProb, reason };
}

function trendAndProb(history) {
    const streakInfo = detectStreakAndBreak(history);
    const { currentResult, streak, breakProb } = streakInfo;
    if (!currentResult) return 0;
    const last15 = history.slice(0, 15).map(h => h.Ket_qua);
    const weights = last15.map((_, i) => Math.pow(1.2, last15.length - 1 - i));
    const taiWeighted = weights.reduce((sum, w, i) => last15[i] === 'Tài' ? sum + w : sum, 0);
    const xiuWeighted = weights.reduce((sum, w, i) => last15[i] === 'Xỉu' ? sum + w : sum, 0);
    const totalWeight = taiWeighted + xiuWeighted;
    if (streak >= 4 && breakProb < 0.6) return currentResult === 'Tài' ? 1 : 2;
    else if (breakProb > 0.6) return currentResult === 'Tài' ? 2 : 1;
    else return currentResult === 'Tài' ? 2 : 1;
}

function shortPattern(history) {
    const streakInfo = detectStreakAndBreak(history);
    const { currentResult, streak } = streakInfo;
    if (!currentResult) return 0;
    const last4 = history.slice(0, 4).map(h => h.Ket_qua);
    if (last4.length === 4 && last4[0] !== last4[1] && last4[1] !== last4[2] && last4[2] !== last4[3]) return currentResult === 'Tài' ? 2 : 1;
    if (streak >= 2 && streak <= 3) return currentResult === 'Tài' ? 1 : 2;
    return currentResult === 'Tài' ? 2 : 1;
}

function meanDeviation(history) {
    const currentResult = history[0]?.Ket_qua;
    if (!currentResult) return 0;
    const last20 = history.slice(0, 20).map(h => h.Ket_qua);
    const taiCount = last20.filter(r => r === 'Tài').length;
    const xiuCount = last20.length - taiCount;
    const deviation = Math.abs(taiCount - xiuCount) / last20.length;
    if (deviation > 0.25) return taiCount < xiuCount ? 1 : 2;
    return currentResult === 'Tài' ? 2 : 1;
}

function recentSwitch(history) {
    const currentResult = history[0]?.Ket_qua;
    if (!currentResult) return 0;
    const last8 = history.slice(0, 8).map(h => h.Ket_qua);
    let switches = 0;
    for (let i = 1; i < last8.length; i++) {
        if (last8[i] !== last8[i - 1]) switches++;
    }
    if (switches >= 5) return currentResult === 'Tài' ? 2 : 1;
    return currentResult === 'Tài' ? 1 : 2;
}

function aiHtddLogic(history) {
    if (!history.length || history.length < 5) return { prediction: null, reason: 'Không đủ dữ liệu', source: 'AI HTDD' };
    const streakInfo = detectStreakAndBreak(history);
    const { streak, currentResult } = streakInfo;
    const prediction = currentResult === 'Tài' ? 'Xỉu' : 'Tài';
    return { prediction, reason: '[AI Default] Mặc định bẻ nhẹ', source: 'AI HTDD' };
}

function generatePredictionAdvanced(history) {
    if (!history.length || history.length < 5) {
        const defaultPrediction = history.length && history[0].Ket_qua === 'Tài' ? 'Xỉu' : 'Tài';
        return { prediction: defaultPrediction, reason: "Không đủ dữ liệu (<5 phiên), dự đoán ngược kết quả cuối.", confidence: 55.0 };
    }
    const aiEngineResult = generateAIPrediction('betvip', history);
    const streakInfo = detectStreakAndBreak(history);
    const { streak, currentResult } = streakInfo;
    const trendPred = trendAndProb(history) === 1 ? 'Tài' : 'Xỉu';
    const bridgePred = smartBridgeBreak(history).prediction === 1 ? 'Tài' : 'Xỉu';
    const aiPred = aiHtddLogic(history).prediction;
    let finalPrediction = aiPred || (bridgePred === trendPred ? bridgePred : (currentResult === 'Tài' ? 'Xỉu' : 'Tài'));
    let confidencePercentage = 75.0;
    return { prediction: finalPrediction, reason: "Dự đoán tổng hợp mô hình", confidence: confidencePercentage };
}

function updateHistory(currentSession) {
    const sessionExists = historyList.some(item => item.Phien === currentSession.Phien);
    if (!sessionExists) {
        historyList.unshift(currentSession);
        if (historyList.length > MAX_HISTORY_SIZE) historyList.pop();
        saveExternalHistory();
    }
}

function recordPrediction(phien, prediction, confidence, reason) {
    const existingPred = learningData.predictions.find(p => p.phien === phien.toString());
    if (existingPred) return;
    learningData.predictions.unshift({
        phien: phien.toString(),
        prediction,
        confidence,
        reason,
        timestamp: Date.now(),
        verified: false
    });
    if (learningData.predictions.length > MAX_HISTORY_SIZE) learningData.predictions = learningData.predictions.slice(0, MAX_HISTORY_SIZE);
    savePredictionHistory();
}

function verifyPredictions(currentHistory) {
    if (!currentHistory || currentHistory.length === 0) return;
    let latestPhien = 0;
    currentHistory.forEach(d => {
        const phien = parseInt(d.Phien);
        if (phien > latestPhien) latestPhien = phien;
    });
    const unverified = learningData.predictions.filter(p => !p.verified);
    for (const pred of unverified) {
        const actual = currentHistory.find(d => d.Phien?.toString() === pred.phien);
        if (actual) {
            pred.verified = true;
            pred.actual = actual.Ket_qua;
            pred.isCorrect = pred.prediction === actual.Ket_qua;
            if (pred.isCorrect) learningData.correctPredictions++;
            learningData.totalPredictions++;
        }
    }
    savePredictionHistory();
}

router.get('/', async (req, res) => {
    try {
        const response = await axios.get(API_URL, { timeout: 10000 });
        const rawData = response.data;
        const listData = rawData.list;
        if (!Array.isArray(listData) || !listData.length) return res.status(500).json({ error: "Không có dữ liệu hợp lệ" });
        const parsedList = parseRawData(listData);
        if (!parsedList.length) return res.status(500).json({ error: "Dữ liệu không phân tích được" });
        const currentParsed = parsedList[0];
        if (currentParsed.sid !== lastSid) {
            lastSid = currentParsed.sid;
            parsedList.reverse().forEach(p => updateHistory(p));
            verifyPredictions(historyList);
        }
        const { prediction, reason, confidence } = generatePredictionAdvanced(historyList);
        const nextPhien = currentParsed.Phien + 1;
        recordPrediction(nextPhien, prediction, confidence, reason);
        res.json({
            id: 'API BETVIP TAI XIU - All in One Server',
            phien_ket_thuc: currentParsed.Phien,
            Xuc_xac_1: currentParsed.Xuc_xac_1,
            Xuc_xac_2: currentParsed.Xuc_xac_2,
            Xuc_xac_3: currentParsed.Xuc_xac_3,
            Tong: currentParsed.Tong,
            Ket_qua: currentParsed.Ket_qua,
            phien_du_doan: nextPhien,
            du_doan: prediction,
            do_tin_cay: `${confidence.toFixed(2)}%`,
            ly_do: reason
        });
    } catch (error) {
        res.status(500).json({ error: 'Lỗi khi fetch dữ liệu', details: error.message });
    }
});

router.get('/ls', (req, res) => {
    res.json({ id: 'API BY BO NHAY DZ', type: 'Betvip Tai Xiu - Lịch sử gốc', total: historyList.length, data: historyList });
});

router.get('/lsdudoan', (req, res) => {
    const historyWithStatus = learningData.predictions.map(p => ({
        phien: p.phien, du_doan: p.prediction, thuc_te: p.actual || 'Chưa có', trang_thai: p.verified ? (p.isCorrect ? '✅' : '❌') : '⏳', ti_le: `${p.confidence.toFixed(2)}%`, ghi_chu: p.reason, timestamp: p.timestamp
    }));
    res.json({ id: 'API BY BO NHAY DZ', type: 'Betvip Tai Xiu - Lịch sử dự đoán', total: historyWithStatus.length, data: historyWithStatus });
});

router.get('/taixiu', async (req, res) => {
    const { prediction, reason, confidence } = generatePredictionAdvanced(historyList);
    const nextPhien = historyList.length > 0 ? historyList[0].Phien + 1 : 0;
    res.json({ id: 'API BETVIP - All in One Server', phien: nextPhien.toString(), du_doan: prediction, ti_le: `${confidence.toFixed(2)}%`, ghi_chu: reason });
});

module.exports = router;
