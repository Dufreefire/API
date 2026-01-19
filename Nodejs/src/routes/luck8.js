const express = require('express');
const router = express.Router();
const axios = require('axios');
const { generateAIPrediction, updateGameLearning, getGameStats } = require('../core/GameAIFactory');

const EXTERNAL_API_URL = 'http://luck8bot.com/api/GetNewLottery/LT_Taixiu';
const POLL_INTERVAL = 5000;
const AUTO_PREDICT_INTERVAL = 3000;

let externalHistory = [];
let lastPredictedPhien = null;
let predictionHistory = [];
let patternHistory = "";
const MAX_HISTORY = 100;
const MIN_HISTORY_FOR_PREDICTION = 5;
let lastPhien = null;
let pollingActive = false;

function getTaiXiu(sum) {
  return sum >= 11 ? 'Tài' : 'Xỉu';
}

function updatePattern(result) {
  if (patternHistory.length >= 20) {
    patternHistory = patternHistory.slice(1);
  }
  patternHistory += result;
}

function advancedPredictPattern(history) {
  if (history.length < MIN_HISTORY_FOR_PREDICTION) return { du_doan: "Chưa đủ dữ liệu", do_tin_cay: 0, ghi_chu: `Cần tối thiểu ${MIN_HISTORY_FOR_PREDICTION} phiên.` };

  const lastChar = history[history.length - 1];
  const oppositeChar = lastChar === 't' ? 'x' : 't';

  // Logic mới: Dự đoán dựa trên tổng điểm phiên gần nhất
  // Mặc dù user nói "như ở trên là xỉu 6" (từ 3-10 là xỉu, 11-18 là tài)
  // Nhưng đây là logic tính kết quả phiên ĐÃ QUA. 
  // Đối với DỰ ĐOÁN phiên tiếp theo, chúng ta vẫn dùng logic soi cầu cơ bản
  // hoặc có thể hiểu user muốn dự đoán theo một quy luật cố định nào đó?
  // "tự tạo lịch sử và logic luôn đủ 5 phiên mới dự đoán từ 3-10 là xỉu từ 11 đến 18 là tài"
  // Có thể ý user là dự đoán phiên tới dựa trên logic Tài/Xỉu chuẩn.

  const lastSix = history.slice(-6).toLowerCase();
  const giangCoPattern1 = /^(tx){3}$/;
  const giangCoPattern2 = /^(xt){3}$/;

  if (giangCoPattern1.test(lastSix) || giangCoPattern2.test(lastSix)) {
    return {
      du_doan: oppositeChar === 't' ? "Tài" : "Xỉu",
      do_tin_cay: 85,
      ghi_chu: "Cầu Giằng co (1-1)"
    };
  }

  let streakCount = 1;
  for (let i = history.length - 2; i >= 0; i--) {
    if (history[i] === lastChar) {
      streakCount++;
    } else {
      break;
    }
  }

  if (streakCount >= 5) {
    return {
      du_doan: oppositeChar === 't' ? "Tài" : "Xỉu",
      do_tin_cay: 75,
      ghi_chu: `Bẻ cầu sau bệt ${streakCount} (dự đoán đảo)`
    };
  }

  if (streakCount >= 2 && streakCount < 5) {
    return {
      du_doan: lastChar === 't' ? "Tài" : "Xỉu",
      do_tin_cay: 65,
      ghi_chu: `Bệt ${streakCount} (dự đoán theo bệt)`
    };
  }

  if (history.length >= 6) {
    const lastSixLower = history.slice(-6).toLowerCase();
    if (lastSixLower === 'ttxttx') {
      return { du_doan: "Xỉu", do_tin_cay: 70, ghi_chu: "Cầu 2-1-2 (đang là T T X T T, dự đoán X)" };
    }
    if (lastSixLower === 'xxttxx') {
      return { du_doan: "Tài", do_tin_cay: 70, ghi_chu: "Cầu 2-1-2 (đang là X X T X X, dự đoán T)" };
    }
  }

  return {
    du_doan: oppositeChar === 't' ? "Tài" : "Xỉu",
    do_tin_cay: 50,
    ghi_chu: "Không rõ cầu (Đảo cầu mặc định)"
  };
}

async function pollExternalData() {
  try {
    const response = await axios.get(EXTERNAL_API_URL, {
      timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    
    const json = response.data;
    if (json && json.state === 1 && json.data) {
      const data = json.data;
      const phien = data.Expect;
      
      if (phien !== lastPhien) {
        lastPhien = phien;
        
        const openCode = data.OpenCode || "";
        const diceArr = openCode.split(',').map(Number);
        const d1 = diceArr[0] || 0;
        const d2 = diceArr[1] || 0;
        const d3 = diceArr[2] || 0;
        const sum = d1 + d2 + d3;
        const ketqua = getTaiXiu(sum);
        
        const result = {
          Phien: phien,
          Xuc_xac_1: d1,
          Xuc_xac_2: d2,
          Xuc_xac_3: d3,
          Tong: sum,
          Ket_qua: ketqua,
          timestamp: Date.now()
        };
        
        externalHistory.unshift(result);
        if (externalHistory.length > MAX_HISTORY) {
          externalHistory = externalHistory.slice(0, MAX_HISTORY);
        }
        
        const patternChar = ketqua === "Tài" ? "t" : "x";
        updatePattern(patternChar);
        
        const prediction = advancedPredictPattern(patternHistory);
        const nextPhien = (BigInt(phien) + BigInt(1)).toString();
        
        predictionHistory.unshift({
          phien: nextPhien,
          du_doan: prediction.du_doan,
          ti_le: `${prediction.do_tin_cay}%`,
          ghi_chu: prediction.ghi_chu,
          timestamp: Date.now(),
          verified: false
        });
        
        if (predictionHistory.length > MAX_HISTORY) {
          predictionHistory = predictionHistory.slice(0, MAX_HISTORY);
        }
        
        console.log(`[Luck8] 🎲 Phiên ${phien}: ${diceArr.join('-')} = ${sum} (${ketqua})`);
      }
    }
  } catch (error) {
    console.error('[Luck8] Error polling data:', error.message);
  }
}

function startPolling() {
  if (pollingActive) return;
  pollingActive = true;
  
  console.log('[Luck8] Starting external API polling...');
  
  pollExternalData();
  
  setInterval(() => {
    pollExternalData();
  }, POLL_INTERVAL);
}

router.get('/', async (req, res) => {
  try {
    await pollExternalData();
    
    if (externalHistory.length === 0) {
      return res.status(503).json({ error: 'Đang tải dữ liệu, vui lòng thử lại' });
    }
    
    const latest = externalHistory[0];
    const { du_doan, do_tin_cay, ghi_chu } = advancedPredictPattern(patternHistory);
    const phienDuDoan = (BigInt(latest.Phien) + BigInt(1)).toString();

    return res.json({
      id: "API BY BO NHAY DZ",
      Phien: latest.Phien,
      Xuc_xac1: latest.Xuc_xac_1,
      Xuc_xac2: latest.Xuc_xac_2,
      Xuc_xac3: latest.Xuc_xac_3,
      Tong: latest.Tong,
      Ket_qua: latest.Ket_qua,
      Phien_du_doan: phienDuDoan,
      Du_doan: du_doan,
      Do_tin_cay: do_tin_cay,
      Ghi_chu_du_doan: ghi_chu,
      Lich_su_cau_gan_nhat: patternHistory.toUpperCase().split('').join('-')
    });
  } catch (error) {
    console.error('Luck8 - Lỗi:', error.message);
    res.status(500).json({
      error: 'Lỗi khi xử lý',
      details: error.message
    });
  }
});

router.get('/taixiu', async (req, res) => {
  try {
    await pollExternalData();
    
    if (externalHistory.length === 0) {
      return res.status(503).json({ error: 'Đang tải dữ liệu, vui lòng thử lại' });
    }
    
    const latest = externalHistory[0];
    const { du_doan, do_tin_cay, ghi_chu } = advancedPredictPattern(patternHistory);
    const phienDuDoan = (BigInt(latest.Phien) + BigInt(1)).toString();

    return res.json({
      id: "API BY BO NHAY DZ",
      phien: phienDuDoan,
      du_doan: du_doan,
      ti_le: `${do_tin_cay}%`,
      ghi_chu: ghi_chu
    });
  } catch (error) {
    res.status(500).json({ error: 'Lỗi server' });
  }
});

router.get('/taixiu/ls', (req, res) => {
  res.json({
    id: 'API BY BO NHAY DZ',
    type: 'Luck8 Tài Xỉu - Lịch sử gốc',
    total: externalHistory.length,
    data: externalHistory
  });
});

router.get('/taixiu/lsdudoan', (req, res) => {
  for (let i = 0; i < predictionHistory.length; i++) {
    const pred = predictionHistory[i];
    if (!pred.verified) {
      const actual = externalHistory.find(h => h.Phien?.toString() === pred.phien);
      if (actual) {
        pred.verified = true;
        pred.actual = actual.Ket_qua;
        pred.isCorrect = pred.du_doan === actual.Ket_qua;
      }
    }
  }
  
  const latestPhien = externalHistory.length > 0 ? parseInt(externalHistory[0].Phien) : 0;
  
  const historyWithStatus = predictionHistory.map(p => {
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
      du_doan: p.du_doan,
      thuc_te: thucTe,
      trang_thai: status,
      ti_le: p.ti_le,
      ghi_chu: p.ghi_chu,
      timestamp: p.timestamp
    };
  });
  
  res.json({
    id: 'API BY BO NHAY DZ',
    type: 'Luck8 Tài Xỉu - Lịch sử dự đoán',
    total: historyWithStatus.length,
    data: historyWithStatus
  });
});

router.get('/lichsu', (req, res) => {
  res.json({
    id: 'API BY BO NHAY DZ',
    type: 'Luck8 - Lịch sử',
    history: externalHistory.slice(0, 20),
    total: externalHistory.length
  });
});

function verifyPredictions() {
  for (const pred of predictionHistory) {
    if (pred.verified) continue;
    
    const actual = externalHistory.find(h => h.Phien?.toString() === pred.phien);
    if (actual) {
      pred.verified = true;
      pred.actual = actual.Ket_qua;
      pred.isCorrect = pred.du_doan === actual.Ket_qua;
      console.log(`[Luck8] Verified phien ${pred.phien}: ${pred.isCorrect ? '✅' : '❌'}`);
    }
  }
}

function autoPrediction() {
  try {
    if (externalHistory.length === 0) return;
    
    const latest = externalHistory[0];
    const nextPhien = (BigInt(latest.Phien) + BigInt(1)).toString();
    
    if (lastPredictedPhien !== nextPhien) {
      verifyPredictions();
      
      const prediction = advancedPredictPattern(patternHistory);
      
      const existingPred = predictionHistory.find(p => p.phien === nextPhien);
      if (!existingPred) {
        predictionHistory.unshift({
          phien: nextPhien,
          du_doan: prediction.du_doan,
          ti_le: `${prediction.do_tin_cay}%`,
          ghi_chu: prediction.ghi_chu,
          timestamp: Date.now(),
          verified: false
        });
        
        if (predictionHistory.length > MAX_HISTORY) {
          predictionHistory = predictionHistory.slice(0, MAX_HISTORY);
        }
        
        lastPredictedPhien = nextPhien;
        console.log(`[Luck8-Auto] Phien ${nextPhien}: ${prediction.du_doan} (${prediction.do_tin_cay}%)`);
      }
    }
  } catch (error) {
    console.error('[Luck8-Auto] Error:', error.message);
  }
}

function startAutoPrediction() {
  setInterval(autoPrediction, AUTO_PREDICT_INTERVAL);
  console.log('[Luck8] Auto-prediction started (every 3s)');
}

startPolling();
startAutoPrediction();

module.exports = router;
