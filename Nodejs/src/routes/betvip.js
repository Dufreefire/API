const express = require('express');
const router = express.Router();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { generateAIPrediction, updateGameLearning, getGameStats } = require('../core/GameAIFactory');

const API_URL = "https://wtxmd52.macminim6.online/v1/txmd5/sessions";
const MAX_HISTORY_SIZE = 100;
const AUTO_PREDICT_INTERVAL = 3000;
let lastPredictedPhien = null;

const HISTORY_DIR = path.join(__dirname, '../data/history');
const PREDICTION_HISTORY_FILE = path.join(HISTORY_DIR, 'prediction_history_betvip_md5.json');
const EXTERNAL_HISTORY_FILE = path.join(HISTORY_DIR, 'external_history_betvip_md5.json');

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
            console.log(`[Betvip-MD5] External history loaded: ${historyList.length} records`);
        }
    } catch (error) {
        console.error('[Betvip-MD5] Error loading external history:', error.message);
    }
}

function saveExternalHistory() {
    try {
        fs.writeFileSync(EXTERNAL_HISTORY_FILE, JSON.stringify(historyList, null, 2));
    } catch (error) {
        console.error('[Betvip-MD5] Error saving external history:', error.message);
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

function generatePredictionAdvanced(history) {
    if (!history.length || history.length < 5) {
        const defaultPrediction = history.length && history[0].Ket_qua === 'Tài' ? 'Xỉu' : 'Tài';
        return { prediction: defaultPrediction, reason: "Không đủ dữ liệu", confidence: 55.0 };
    }
    const currentResult = history[0].Ket_qua;
    return { prediction: currentResult === 'Tài' ? 'Xỉu' : 'Tài', reason: "Bẻ cầu mặc định", confidence: 70.0 };
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
    try { fs.writeFileSync(PREDICTION_HISTORY_FILE, JSON.stringify(learningData, null, 2)); } catch(e){}
}

function verifyPredictions(currentHistory) {
    if (!currentHistory || currentHistory.length === 0) return;
    const unverified = learningData.predictions.filter(p => !p.verified);
    for (const pred of unverified) {
        const actual = currentHistory.find(d => d.Phien?.toString() === pred.phien);
        if (actual) {
            pred.verified = true;
            pred.actual = actual.Ket_qua;
            pred.isCorrect = pred.prediction === actual.Ket_qua;
        }
    }
    try { fs.writeFileSync(PREDICTION_HISTORY_FILE, JSON.stringify(learningData, null, 2)); } catch(e){}
}

router.get('/', async (req, res) => {
    try {
        const response = await axios.get(API_URL, { timeout: 10000 });
        const rawData = response.data;
        const listData = rawData.list;
        if (!Array.isArray(listData) || !listData.length) return res.status(500).json({ error: "Không có dữ liệu" });
        const parsedList = parseRawData(listData);
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
            id: 'API BETVIP MD5 - All in One Server',
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
        res.status(500).json({ error: 'Lỗi' });
    }
});

router.get('/ls', (req, res) => {
    res.json({ id: 'API BY BO NHAY DZ', type: 'Betvip MD5 - Lịch sử gốc', total: historyList.length, data: historyList });
});

router.get('/lsdudoan', (req, res) => {
    const historyWithStatus = learningData.predictions.map(p => ({
        phien: p.phien, du_doan: p.prediction, thuc_te: p.actual || 'Chưa có', trang_thai: p.verified ? (p.isCorrect ? '✅' : '❌') : '⏳', ti_le: `${p.confidence.toFixed(2)}%`, ghi_chu: p.reason, timestamp: p.timestamp
    }));
    res.json({ id: 'API BY BO NHAY DZ', type: 'Betvip MD5 - Lịch sử dự đoán', total: historyWithStatus.length, data: historyWithStatus });
});

module.exports = router;
