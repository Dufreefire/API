const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');

const HISTORY_FILE_PATH = path.join(__dirname, '../../data/sum_history.json');
const PREDICTION_HISTORY_FILE = path.join(__dirname, '../data/history/prediction_history_sum.json');
const API_URL = 'https://taixiu1.gsum01.com/api/luckydice1/GetSoiCau';

const HISTORY_DIR = path.join(__dirname, '../data/history');
if (!fsSync.existsSync(HISTORY_DIR)) {
    fsSync.mkdirSync(HISTORY_DIR, { recursive: true });
}

let history = [];
let latestPrediction = { phien: null, ketqua: "Đang chờ phiên mới", time: new Date().toISOString(), reason: "Chưa có dữ liệu lịch sử." };
let modelPredictions = {};
let totalWins = 0;
let totalLosses = 0;

let learningData = {
    predictions: [],
    totalPredictions: 0,
    correctPredictions: 0,
    streakAnalysis: { wins: 0, losses: 0, currentStreak: 0 },
    lastUpdate: null
};

const MAX_HISTORY = 100;
const AUTO_PREDICT_INTERVAL = 3000;
let lastPredictedPhien = null;

function loadPredictionHistory() {
    try {
        if (fsSync.existsSync(PREDICTION_HISTORY_FILE)) {
            const data = fsSync.readFileSync(PREDICTION_HISTORY_FILE, 'utf8');
            const parsed = JSON.parse(data);
            learningData = { ...learningData, ...parsed };
            console.log('[Sum] Prediction history loaded successfully');
        }
    } catch (error) {
        console.error('[Sum] Error loading prediction history:', error.message);
    }
}

function savePredictionHistory() {
    try {
        fsSync.writeFileSync(PREDICTION_HISTORY_FILE, JSON.stringify(learningData, null, 2));
    } catch (error) {
        console.error('[Sum] Error saving prediction history:', error.message);
    }
}

async function readHistoryFile() {
    try {
        const data = await fs.readFile(HISTORY_FILE_PATH, 'utf8');
        const fileContent = JSON.parse(data);
        history = fileContent.history || [];
        modelPredictions = fileContent.modelPredictions || {};
        totalWins = fileContent.totalWins || 0;
        totalLosses = fileContent.totalLosses || 0;
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.error('Sum - Lỗi khi đọc file lịch sử:', error);
        }
    }
}

async function writeHistoryFile() {
    try {
        const data = { history, modelPredictions, totalWins, totalLosses };
        await fs.writeFile(HISTORY_FILE_PATH, JSON.stringify(data, null, 2), 'utf8');
    } catch (error) {
        console.error('Sum - Lỗi khi ghi file lịch sử:', error);
    }
}

function getResultFromDiceSum(diceSum) {
    return diceSum >= 11 ? 'Tài' : 'Xỉu';
}

function detectStreak(hist) {
    if (!hist || hist.length === 0) return { streak: 0, currentResult: null };
    let streak = 1;
    const currentResult = hist[hist.length - 1].result;
    for (let i = hist.length - 2; i >= 0; i--) {
        if (hist[i].result === currentResult) streak++;
        else break;
    }
    return { streak, currentResult };
}

function superEnsembleModel(hist) {
    if (hist.length < 10) {
        return {
            prediction: 'Đang chờ phiên mới',
            reason: 'Không đủ dữ liệu lịch sử để dự đoán đáng tin cậy.',
            scores: { taiScore: 0, xiuScore: 0 },
            confidence: 50
        };
    }

    const { streak, currentResult } = detectStreak(hist);
    let prediction, reason, confidence;

    if (streak >= 5) {
        prediction = currentResult === 'Tài' ? 'Xỉu' : 'Tài';
        reason = `Bẻ cầu sau chuỗi ${currentResult} ${streak} phiên liên tiếp`;
        confidence = 75 + Math.min(streak * 2, 15);
    } else if (streak >= 3) {
        prediction = currentResult;
        reason = `Theo cầu ${currentResult} đang chạy ${streak} phiên`;
        confidence = 65 + streak * 3;
    } else {
        const last20 = hist.slice(-20);
        const taiCount = last20.filter(h => h.result === 'Tài').length;
        const xiuCount = last20.length - taiCount;
        
        if (taiCount > xiuCount + 3) {
            prediction = 'Xỉu';
            reason = `Cân bằng sau khi Tài chiếm ưu thế (${taiCount}/${last20.length})`;
            confidence = 68;
        } else if (xiuCount > taiCount + 3) {
            prediction = 'Tài';
            reason = `Cân bằng sau khi Xỉu chiếm ưu thế (${xiuCount}/${last20.length})`;
            confidence = 68;
        } else {
            prediction = currentResult === 'Tài' ? 'Xỉu' : 'Tài';
            reason = 'Dự đoán đảo chiều mặc định';
            confidence = 55;
        }
    }

    return { prediction, reason, scores: { taiScore: 0, xiuScore: 0 }, confidence };
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

    if (learningData.predictions.length > MAX_HISTORY) {
        learningData.predictions = learningData.predictions.slice(0, MAX_HISTORY);
    }

    savePredictionHistory();
}

function verifyPredictions(currentHistory) {
    if (!currentHistory || currentHistory.length === 0) return;

    let latestPhien = 0;
    currentHistory.forEach(d => {
        const phien = parseInt(d.session);
        if (phien > latestPhien) latestPhien = phien;
    });

    const unverified = learningData.predictions.filter(p => !p.verified);
    
    for (const pred of unverified) {
        const actual = currentHistory.find(d => d.session?.toString() === pred.phien);
        if (actual) {
            const actualResult = actual.result;
            pred.verified = true;
            pred.actual = actualResult;
            pred.isCorrect = pred.prediction === actualResult;

            if (pred.isCorrect) {
                learningData.correctPredictions++;
                learningData.streakAnalysis.wins++;
                learningData.streakAnalysis.currentStreak = 
                    learningData.streakAnalysis.currentStreak >= 0 
                        ? learningData.streakAnalysis.currentStreak + 1 
                        : 1;
            } else {
                learningData.streakAnalysis.losses++;
                learningData.streakAnalysis.currentStreak = 
                    learningData.streakAnalysis.currentStreak <= 0 
                        ? learningData.streakAnalysis.currentStreak - 1 
                        : -1;
            }

            learningData.totalPredictions++;
            learningData.lastUpdate = new Date().toISOString();
        }
    }

    const oldLength = learningData.predictions.length;
    learningData.predictions = learningData.predictions.filter(p => {
        if (p.verified) return true;
        const phienNum = parseInt(p.phien);
        if (latestPhien - phienNum > 150) return false;
        return true;
    });
    
    if (learningData.predictions.length !== oldLength) {
        console.log(`[Sum] Cleaned ${oldLength - learningData.predictions.length} old unverified predictions`);
    }

    savePredictionHistory();
}

async function fetchGameData() {
    try {
        const fetch = (await import('node-fetch')).default;
        const response = await fetch(API_URL);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();

        if (Array.isArray(data) && data.length > 0) {
            const processedHistory = data.map(item => ({
                session: item.SessionId,
                result: getResultFromDiceSum(item.DiceSum),
                totalScore: item.DiceSum,
                diceValues: [item.FirstDice, item.SecondDice, item.ThirdDice]
            })).reverse();

            const lastKnownSession = history.length > 0 ? history[history.length - 1].session : null;
            const newEntries = processedHistory.filter(item => item.session > lastKnownSession);

            if (newEntries.length > 0) {
                history.push(...newEntries);
                if (history.length > 500) history = history.slice(-500);

                verifyPredictions(history);

                const nextPrediction = superEnsembleModel(history);
                const lastGame = history[history.length - 1];
                latestPrediction = {
                    phien: lastGame.session + 1,
                    ketqua: nextPrediction.prediction,
                    time: new Date().toISOString(),
                    reason: nextPrediction.reason,
                    confidence: nextPrediction.confidence
                };

                if (nextPrediction.prediction !== 'Đang chờ phiên mới') {
                    recordPrediction(latestPrediction.phien, nextPrediction.prediction, nextPrediction.confidence, nextPrediction.reason);
                }

                await writeHistoryFile();
            }
        }
        return latestPrediction;
    } catch (error) {
        console.error('Sum - Lỗi khi lấy dữ liệu game:', error.message);
        return latestPrediction;
    }
}

router.get('/', async (req, res) => {
    await readHistoryFile();
    const prediction = await fetchGameData();
    const lastHistory = history[history.length - 1];

    res.json({
        id: "API SUM - All in One Server",
        phien_truoc: lastHistory?.session,
        xuc_xac: lastHistory?.diceValues,
        tong_xuc_xac: lastHistory?.totalScore,
        ket_qua: lastHistory?.result,
        phien_sau: prediction?.phien,
        du_doan: prediction?.ketqua,
        do_tin_cay: `${prediction?.confidence?.toFixed(2) || 50}%`,
        giai_thich: prediction?.reason,
        thoi_gian_cap_nhat: prediction?.time,
        tong_thang: totalWins,
        tong_thua: totalLosses
    });
});

router.get('/taixiu', async (req, res) => {
    await readHistoryFile();
    const prediction = await fetchGameData();
    const lastHistory = history[history.length - 1];

    res.json({
        id: "API SUM - All in One Server",
        phien_truoc: lastHistory?.session,
        xuc_xac: lastHistory?.diceValues,
        tong_xuc_xac: lastHistory?.totalScore,
        ket_qua: lastHistory?.result,
        phien_sau: prediction?.phien,
        du_doan: prediction?.ketqua,
        do_tin_cay: `${prediction?.confidence?.toFixed(2) || 50}%`,
        giai_thich: prediction?.reason,
        thoi_gian_cap_nhat: prediction?.time,
        tong_thang: totalWins,
        tong_thua: totalLosses
    });
});

router.get('/taixiu/ls', (req, res) => {
    const formattedHistory = history.slice(-100).reverse().map(h => ({
        Phien: h.session,
        Xuc_xac_1: h.diceValues[0],
        Xuc_xac_2: h.diceValues[1],
        Xuc_xac_3: h.diceValues[2],
        Tong: h.totalScore,
        Ket_qua: h.result
    }));

    res.json({
        id: 'API BY BO NHAY DZ',
        type: 'Sum Tài Xỉu - Lịch sử gốc',
        total: formattedHistory.length,
        data: formattedHistory
    });
});

router.get('/taixiu/lsdudoan', (req, res) => {
    const predictions = learningData.predictions || [];
    const latestPhien = history.length > 0 ? history[history.length - 1].session : 0;
    
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
            ly_do: p.reason,
            timestamp: p.timestamp
        };
    });
    
    res.json({
        id: 'API BY BO NHAY DZ',
        type: 'Sum Tài Xỉu - Lịch sử dự đoán',
        total: historyWithStatus.length,
        thong_ke: {
            tong_du_doan: learningData.totalPredictions,
            dung: learningData.correctPredictions,
            ti_le_dung: learningData.totalPredictions > 0 
                ? (learningData.correctPredictions / learningData.totalPredictions * 100).toFixed(2) + '%'
                : 'N/A'
        },
        data: historyWithStatus
    });
});

router.get('/stats', (req, res) => {
    res.json({
        totalPredictions: learningData.totalPredictions,
        correctPredictions: learningData.correctPredictions,
        accuracy: learningData.totalPredictions > 0 
            ? (learningData.correctPredictions / learningData.totalPredictions * 100).toFixed(2) + '%'
            : 'N/A',
        streakAnalysis: learningData.streakAnalysis,
        historyCount: history.length,
        lastUpdate: learningData.lastUpdate
    });
});

async function autoPrediction() {
    try {
        await fetchGameData();
        
        if (history.length < 10) return;
        
        const lastGame = history[history.length - 1];
        const nextPhien = lastGame.session + 1;
        
        if (lastPredictedPhien !== nextPhien) {
            const prediction = superEnsembleModel(history);
            
            if (prediction.prediction !== 'Đang chờ phiên mới') {
                recordPrediction(nextPhien, prediction.prediction, prediction.confidence, prediction.reason);
                lastPredictedPhien = nextPhien;
                console.log(`[Sum-Auto] Phien ${nextPhien}: ${prediction.prediction} (${prediction.confidence}%)`);
            }
        }
    } catch (error) {
        console.error('[Sum-Auto] Error:', error.message);
    }
}

function startAutoPrediction() {
    setInterval(autoPrediction, AUTO_PREDICT_INTERVAL);
    console.log('[Sum] Auto-prediction started (every 3s)');
}

router.get('/lsdudoan', (req, res) => {
    const predictions = learningData.predictions || [];
    const latestPhien = history.length > 0 ? history[history.length - 1].session : 0;
    
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
            ly_do: p.reason,
            timestamp: p.timestamp
        };
    });
    
    res.json({
        id: 'API BY BO NHAY DZ',
        type: 'Sum - Lịch sử dự đoán',
        total: historyWithStatus.length,
        thong_ke: {
            tong_du_doan: learningData.totalPredictions,
            dung: learningData.correctPredictions,
            ti_le_dung: learningData.totalPredictions > 0 
                ? (learningData.correctPredictions / learningData.totalPredictions * 100).toFixed(2) + '%'
                : 'N/A'
        },
        data: historyWithStatus
    });
});

loadPredictionHistory();
startAutoPrediction();

module.exports = router;
