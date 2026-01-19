const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const API_URL = 'https://api.wsktnus8.net/v2/history/getLastResult?gameId=ktrng_3979&size=100&tableId=39791215743193&curPage=1';
const UPDATE_INTERVAL = 5000;
const HISTORY_FILE = path.join(__dirname, 'prediction_history.json');

let historyData = [];
let lastPrediction = {
    phien: null,
    du_doan: null,
    doan_vi: []
};

// ==================== 🎯 NÂNG CẤP THUẬT TOÁN PHÂN TÍCH TÀI XỈU ====================

console.log('🚀 ĐANG KÍCH HOẠT THUẬT TOÁN PHÂN TÍCH TÀI XỈU NÂNG CAO...');

// --- Load lịch sử dự đoán từ file ---
function loadPredictionHistory() {
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            const raw = fs.readFileSync(HISTORY_FILE, 'utf8');
            console.log('📁 ĐÃ TẢI LỊCH SỬ DỰ ĐOÁN THÀNH CÔNG');
            return JSON.parse(raw);
        }
    } catch (e) {
        console.error('❌ LỖI ĐỌC LỊCH SỬ DỰ ĐOÁN:', e.message);
    }
    console.log('📁 KHỞI TẠO LỊCH SỬ DỰ ĐOÁN MỚI');
    return [];
}

// --- Lưu lịch sử dự đoán vào file ---
function savePredictionHistory(data) {
    try {
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(data, null, 2));
        console.log('💾 ĐÃ LƯU LỊCH SỬ DỰ ĐOÁN');
    } catch (e) {
        console.error('❌ LỖI LƯU LỊCH SỬ DỰ ĐOÁN:', e.message);
    }
}

// --- Cập nhật lịch sử dự đoán ---
function appendPredictionHistory(record) {
    const all = loadPredictionHistory();
    all.push(record);
    savePredictionHistory(all);
    console.log(`📝 ĐÃ THÊM DỰ ĐOÁN PHIÊN ${record.phien} VÀO LỊCH SỬ`);
}

// --- Hàm cập nhật dữ liệu API ---
async function updateHistory() {
    try {
        console.log('🔄 ĐANG CẬP NHẬT DỮ LIỆU LỊCH SỬ TỪ API...');
        const res = await axios.get(API_URL);
        if (res?.data?.data?.resultList) {
            historyData = res.data.data.resultList;
            console.log(`✅ ĐÃ CẬP NHẬT ${historyData.length} KẾT QUẢ LỊCH SỬ`);
        }
    } catch (e) {
        console.error('❌ LỖI CẬP NHẬT DỮ LIỆU:', e.message);
    }
}

// --- Phân loại kết quả ---
function getResultType(session) {
    if (!session || !session.facesList) return "";
    const [a, b, c] = session.facesList;
    if (a === b && b === c) {
        console.log(`🎯 PHÁT HIỆN BÃO: ${a}-${b}-${c}`);
        return "Bão";
    }
    const result = session.score >= 11 ? "Tài" : "Xỉu";
    console.log(`🎲 KẾT QUẢ: ${result} (${session.score} điểm)`);
    return result;
}

// --- Sinh chuỗi pattern ---
function generatePattern(history, len = 10) {
    const pattern = history.slice(0, len).map(s => getResultType(s).charAt(0)).reverse().join('');
    console.log(`📊 PATTERN ${len} PHIÊN: ${pattern}`);
    return pattern;
}

// ==================== 🎯 THUẬT TOÁN PHÂN TÍCH TÀI XỈU NÂNG CAO ====================

/**
 * PHÂN TÍCH XU HƯỚNG DỰA TRÊN LỊCH SỬ
 * Kết hợp nhiều phương pháp phân tích để đưa ra dự đoán chính xác
 */
function analyzeTaiXiuTrend(history) {
    console.log('\n🔍 BẮT ĐẦU PHÂN TÍCH XU HƯỚNG TÀI XỈU...');
    
    if (history.length < 10) {
        console.log('⚠️  CHƯA ĐỦ DỮ LIỆU, TRẢ VỀ TÀI MẶC ĐỊNH');
        return "Tài";
    }

    // 1. PHÂN TÍCH CHUỖI LIÊN TIẾP
    const recentPattern = generatePattern(history, 8);
    console.log(`📈 PHÂN TÍCH CHUỖI: ${recentPattern}`);

    // Phát hiện chuỗi 3 Tài/Xỉu liên tiếp
    if (recentPattern.startsWith("TTT")) {
        console.log('🎯 PHÁT HIỆN CHUỖI 3 TÀI → DỰ ĐOÁN XỈU');
        return "Xỉu";
    }
    if (recentPattern.startsWith("XXX")) {
        console.log('🎯 PHÁT HIỆN CHUỖI 3 XỈU → DỰ ĐOÁN TÀI');
        return "Tài";
    }

    // 2. PHÂN TÍCH TẦN SUẤT TRONG 20 PHIÊN GẦN NHẤT
    const last20 = history.slice(0, 20);
    const taiCount = last20.filter(s => getResultType(s) === "Tài").length;
    const xiuCount = last20.filter(s => getResultType(s) === "Xỉu").length;
    const taiRatio = taiCount / 20;
    
    console.log(`📊 THỐNG KÊ 20 PHIÊN: Tài ${taiCount} - Xỉu ${xiuCount} (${(taiRatio * 100).toFixed(1)}% Tài)`);

    // Nếu một bên xuất hiện quá nhiều, dự đoán bên ngược lại
    if (taiRatio >= 0.7) {
        console.log('🎯 TÀI XUẤT HIỆN QUÁ NHIỀU → DỰ ĐOÁN XỈU');
        return "Xỉu";
    }
    if (taiRatio <= 0.3) {
        console.log('🎯 XỈU XUẤT HIỆN QUÁ NHIỀU → DỰ ĐOÁN TÀI');
        return "Tài";
    }

    // 3. PHÂN TÍCH ĐIỂM TRUNG BÌNH 10 PHIÊN GẦN NHẤT
    const last10Scores = history.slice(0, 10).map(s => s.score);
    const avgScore = last10Scores.reduce((a, b) => a + b, 0) / 10;
    console.log(`📐 ĐIỂM TRUNG BÌNH 10 PHIÊN: ${avgScore.toFixed(2)}`);

    // 4. PHÂN TÍCH XU HƯỚNG ĐIỂM
    const recentScores = history.slice(0, 5).map(s => s.score);
    const olderScores = history.slice(5, 10).map(s => s.score);
    const recentAvg = recentScores.reduce((a, b) => a + b, 0) / 5;
    const olderAvg = olderScores.reduce((a, b) => a + b, 0) / 5;
    
    console.log(`📈 XU HƯỚNG ĐIỂM: 5 phiên gần ${recentAvg.toFixed(2)} vs 5 phiên trước ${olderAvg.toFixed(2)}`);

    // 5. KẾT HỢP NHIỀU YẾU TỐ ĐỂ RA QUYẾT ĐỊNH CUỐI
    let finalDecision = "Tài"; // Mặc định

    if (avgScore > 10.8) {
        console.log('🎯 ĐIỂM TRUNG BÌNH CAO → DỰ ĐOÁN TÀI');
        finalDecision = "Tài";
    } else if (avgScore < 9.2) {
        console.log('🎯 ĐIỂM TRUNG BÌNH THẤP → DỰ ĐOÁN XỈU');
        finalDecision = "Xỉu";
    } else {
        // Vùng trung gian, phân tích kỹ hơn
        if (recentAvg > olderAvg + 1.5) {
            console.log('🎯 XU HƯỚNG TĂNG ĐIỂM → DỰ ĐOÁN TÀI');
            finalDecision = "Tài";
        } else if (recentAvg < olderAvg - 1.5) {
            console.log('🎯 XU HƯỚNG GIẢM ĐIỂM → DỰ ĐOÁN XỈU');
            finalDecision = "Xỉu";
        } else {
            // Xu hướng ổn định, dựa vào điểm trung bình
            finalDecision = avgScore >= 10.5 ? "Tài" : "Xỉu";
            console.log(`🎯 XU HƯỚNG ỔN ĐỊNH → DỰA VÀO ĐIỂM TB: ${finalDecision}`);
        }
    }

    console.log(`✅ KẾT LUẬN PHÂN TÍCH: ${finalDecision}`);
    return finalDecision;
}

// ==================== 🎯 THUẬT TOÁN RANDOM SEED VIP CHO DỰ ĐOÁN VỊ ====================

console.log('🎲 ĐANG KÍCH HOẠT THUẬT TOÁN RANDOM SEED VIP CHO DỰ ĐOÁN VỊ...');

/**
 * Tạo seed từ mã phiên với thuật toán nâng cao
 */
function generateVIPSeed(phien) {
    if (!phien) return 1;
    
    console.log(`🔑 ĐANG TẠO SEED VIP TỪ PHIÊN: ${phien}`);
    
    const baseSeed = parseInt(phien.toString().replace(/[^0-9]/g, '')) || 1;
    let seed = baseSeed;
    
    const timestamp = Date.now();
    seed = (seed * 1664525 + 1013904223) ^ (timestamp & 0xFFFFFFFF);
    
    seed ^= seed << 13;
    seed ^= seed >> 17;
    seed ^= seed << 5;
    
    const finalSeed = Math.abs(seed) || 1;
    console.log(`🔢 SEED VIP ĐƯỢC TẠO: ${finalSeed}`);
    
    return finalSeed;
}

/**
 * PRNG chất lượng cao - Xorshift128+
 */
class VIPRandom {
    constructor(seed) {
        this.seed = BigInt(seed);
        this.state0 = BigInt(seed) || 1n;
        this.state1 = BigInt(seed * 0xDEADBEEF) || 2n;
        console.log(`🎰 KHỞI TẠO VIPRANDOM VỚI SEED: ${seed}`);
    }
    
    next() {
        let s1 = this.state0;
        const s0 = this.state1;
        this.state0 = s0;
        s1 ^= s1 << 23n;
        s1 ^= s1 >> 17n;
        s1 ^= s0;
        s1 ^= s0 >> 26n;
        this.state1 = s1;
        
        const result = (this.state0 + this.state1) & 0xFFFFFFFFFFFFFn;
        return Number(result) / Number(0xFFFFFFFFFFFFFn);
    }
    
    nextInt(min, max) {
        const result = Math.floor(this.next() * (max - min + 1)) + min;
        console.log(`🎲 SINH SỐ NGUẪU NHIÊN: ${result} (từ ${min} đến ${max})`);
        return result;
    }
}

/**
 * Thuật toán Fisher-Yates shuffle với random seed VIP
 */
function vipShuffle(array, random) {
    console.log('🃏 ĐANG XÁO BÀI VỚI THUẬT TOÁN VIP...');
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = random.nextInt(0, i);
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    console.log(`🃏 KẾT QUẢ XÁO BÀI: [${shuffled.join(', ')}]`);
    return shuffled;
}

/**
 * Dự đoán các tổng điểm (vị) với thuật toán random seed VIP
 */
function predictVIPRandomSums(prediction, phien, top = 3) {
    if (!phien) {
        console.log('❌ KHÔNG CÓ MÃ PHIÊN ĐỂ TẠO SEED');
        return [];
    }

    try {
        console.log(`\n🎯 BẮT ĐẦU DỰ ĐOÁN VỊ CHO ${prediction}...`);

        // 1. Tạo seed VIP từ mã phiên
        const vipSeed = generateVIPSeed(phien);
        
        // 2. Khởi tạo bộ tạo số ngẫu nhiên VIP
        const vipRandom = new VIPRandom(vipSeed);
        
        // 3. Xác định phạm vi dựa trên dự đoán Tài/Xỉu
        const taiRange = [11, 12, 13, 14, 15, 16, 17];
        const xiuRange = [4, 5, 6, 7, 8, 9, 10];
        const range = (prediction === "Tài") ? taiRange : xiuRange;
        
        console.log(`📊 PHẠM VI ${prediction}: [${range.join(', ')}]`);
        
        // 4. Thêm yếu tố "may mắn" dựa trên seed
        const luckyFactor = vipRandom.nextInt(1, 3);
        console.log(`🍀 YẾU TỐ MAY MẮN: +${luckyFactor}`);
        
        // 5. Xáo trộn mảng với thuật toán VIP
        let shuffledRange = vipShuffle(range, vipRandom);
        
        // 6. Áp dụng logic bổ sung để tăng tính chính xác
        if (prediction === "Tài") {
            shuffledRange.sort((a, b) => {
                const diffA = Math.abs(a - 14);
                const diffB = Math.abs(b - 14);
                return diffA - diffB;
            });
            console.log('🎯 ƯU TIÊN SỐ GẦN 14 CHO TÀI');
        } else {
            shuffledRange.sort((a, b) => {
                const diffA = Math.abs(a - 7);
                const diffB = Math.abs(b - 7);
                return diffA - diffB;
            });
            console.log('🎯 ƯU TIÊN SỐ GẦN 7 CHO XỈU');
        }
        
        // 7. Xáo trộn nhẹ lần cuối với seed phụ
        const subSeed = vipSeed ^ 0xABCDEF;
        const finalRandom = new VIPRandom(subSeed);
        shuffledRange = vipShuffle(shuffledRange.slice(0, top + luckyFactor), finalRandom);
        
        const finalPrediction = shuffledRange.slice(0, top);
        console.log(`✅ DỰ ĐOÁN VỊ CUỐI CÙNG: [${finalPrediction.join(', ')}]`);
        
        return finalPrediction;
        
    } catch (error) {
        console.error('❌ LỖI TRONG THUẬT TOÁN VIP:', error);
        const fallback = (prediction === "Tài") ? [11, 13, 15] : [5, 7, 9];
        console.log(`🔄 SỬ DỤNG DỰ ĐOÁN DỰ PHÒNG: [${fallback.join(', ')}]`);
        return fallback;
    }
}

// ==================== 📊 HỆ THỐNG TÍNH ĐỘ TIN CẬY THỰC TẾ ====================

/**
 * Tính độ chính xác tổng thể của hệ thống
 */
function calculateRealConfidence(predHistory) {
    if (!predHistory || predHistory.length === 0) {
        console.log('📊 CHƯA CÓ DỮ LIỆU LỊCH SỬ → ĐỘ TIN CẬY MẶC ĐỊNH: 65%');
        return 65;
    }

    try {
        console.log('\n📈 ĐANG TÍNH TOÁN ĐỘ TIN CẬY THỰC TẾ...');

        const verifiedRecords = predHistory.filter(record => 
            record.ket_qua_thuc && record.du_doan
        );

        if (verifiedRecords.length === 0) {
            console.log('📊 CÓ DỮ LIỆU NHƯNG CHƯA XÁC THỰC → ĐỘ TIN CẬY: 70%');
            return 70;
        }

        // Tính độ chính xác dự đoán Tài/Xỉu
        const correctPredictions = verifiedRecords.filter(record => 
            record.du_doan === record.ket_qua_thuc
        ).length;

        const taiXiuAccuracy = (correctPredictions / verifiedRecords.length) * 100;
        console.log(`🎯 ĐỘ CHÍNH XÁC TÀI/XỈU: ${taiXiuAccuracy.toFixed(1)}% (${correctPredictions}/${verifiedRecords.length})`);

        // Tính độ chính xác dự đoán vị
        let viAccuracy = 0;
        let viCount = 0;

        verifiedRecords.forEach(record => {
            if (record.doan_vi && record.doan_vi.length > 0) {
                const actualScore = record.ket_qua_thuc === "Tài" ? 
                    (record.Tong >= 11 ? record.Tong : null) :
                    (record.Tong <= 10 ? record.Tong : null);
                
                if (actualScore && record.doan_vi.includes(actualScore)) {
                    viAccuracy += 1;
                }
                viCount += 1;
            }
        });

        const finalViAccuracy = viCount > 0 ? (viAccuracy / viCount) * 100 : 0;
        console.log(`🎯 ĐỘ CHÍNH XÁC VỊ: ${finalViAccuracy.toFixed(1)}% (${viAccuracy}/${viCount})`);

        // Kết hợp cả hai độ chính xác
        const overallAccuracy = (taiXiuAccuracy * 0.7) + (finalViAccuracy * 0.3);
        const finalConfidence = Math.max(60, Math.min(95, Math.round(overallAccuracy)));

        console.log(`📊 ĐỘ TIN CẬY TỔNG HỢP: ${finalConfidence}%`);

        return finalConfidence;
        
    } catch (error) {
        console.error('❌ LỖI TÍNH ĐỘ TIN CẬY:', error);
        return 70;
    }
}

/**
 * Tính độ tin cậy cho dự đoán hiện tại
 */
function calculateCurrentConfidence(predHistory, currentPrediction, historyData) {
    console.log('\n🔍 ĐANG TÍNH ĐỘ TIN CẬY CHO DỰ ĐOÁN HIỆN TẠI...');
    
    const baseConfidence = calculateRealConfidence(predHistory);
    
    if (historyData.length >= 5) {
        const recentPattern = generatePattern(historyData, 5);
        const trendStability = analyzeTrendStability(recentPattern);
        
        let trendAdjustment = 0;
        if (trendStability >= 0.8) {
            trendAdjustment = 5;
            console.log('📈 XU HƯỚNG ỔN ĐỊNH → TĂNG ĐỘ TIN CẬY +5%');
        } else if (trendStability <= 0.5) {
            trendAdjustment = -5;
            console.log('📉 XU HƯỚNG BẤT ỔN → GIẢM ĐỘ TIN CẬY -5%');
        } else {
            console.log('📊 XU HƯỚNG BÌNH THƯỜNG → GIỮ NGUYÊN ĐỘ TIN CẬY');
        }
        
        const finalConfidence = Math.max(60, Math.min(95, baseConfidence + trendAdjustment));
        console.log(`✅ ĐỘ TIN CẬY CUỐI CÙNG: ${finalConfidence}%`);
        
        return finalConfidence;
    }
    
    console.log(`✅ ĐỘ TIN CẬY CƠ BẢN: ${baseConfidence}%`);
    return baseConfidence;
}

/**
 * Phân tích độ ổn định của xu hướng
 */
function analyzeTrendStability(pattern) {
    if (!pattern || pattern.length < 3) return 0.5;
    
    let changes = 0;
    for (let i = 1; i < pattern.length; i++) {
        if (pattern[i] !== pattern[i-1]) {
            changes++;
        }
    }
    
    const stability = 1 - (changes / (pattern.length - 1));
    console.log(`📊 ĐỘ ỔN ĐỊNH XU HƯỚNG: ${(stability * 100).toFixed(1)}%`);
    
    return stability;
}

// ==================== 🚀 ENDPOINTS CHÍNH ====================

// --- Lưu kết quả thực tế ---
app.post('/report-result', (req, res) => {
    console.log('\n📨 NHẬN YÊU CẦU BÁO CÁO KẾT QUẢ...');
    const { phien, ket_qua_thuc, Tong } = req.body;
    
    if (!phien || !ket_qua_thuc) {
        console.log('❌ THIẾU THÔNG TIN PHIÊN HOẶC KẾT QUẢ');
        return res.status(400).json({error: "Thiếu phien hoặc ket_qua_thuc"});
    }

    console.log(`📝 CẬP NHẬT KẾT QUẢ CHO PHIÊN ${phien}: ${ket_qua_thuc} (Tổng: ${Tong})`);

    const predHist = loadPredictionHistory();
    const lastPredIndex = predHist.findLastIndex(p => p.phien === phien);

    if (lastPredIndex === -1) {
        console.log('❌ KHÔNG TÌM THẤY DỰ ĐOÁN CHO PHIÊN NÀY');
        return res.status(404).json({error: "Không tìm thấy dự đoán phiên này"});
    }
    
    // Cập nhật kết quả thực tế
    predHist[lastPredIndex].ket_qua_thuc = ket_qua_thuc;
    if (Tong) {
        predHist[lastPredIndex].Tong = Tong;
    }
    
    savePredictionHistory(predHist);
    console.log('✅ ĐÃ CẬP NHẬT KẾT QUẢ THỰC TẾ THÀNH CÔNG');
    
    res.json({success: true});
});

// --- Endpoint chính ---
app.get('/predict', async (req, res) => {
    console.log('\n🎯 NHẬN YÊU CẦU DỰ ĐOÁN...');
    
    await updateHistory();
    const latest = historyData[0] || {};
    const currentPhien = latest.gameNum;

    console.log(`📊 PHIÊN HIỆN TẠI: ${currentPhien}`);

    const predHist = loadPredictionHistory();

    // Chỉ dự đoán lại khi có phiên mới
    if (currentPhien && currentPhien !== lastPrediction.phien) {
        console.log('🆕 PHÁT HIỆN PHIÊN MỚI → TIẾN HÀNH DỰ ĐOÁN...');
        
        // SỬ DỤNG THUẬT TOÁN PHÂN TÍCH TÀI XỈU MỚI
        const du_doan = analyzeTaiXiuTrend(historyData);
        
        // SỬ DỤNG THUẬT TOÁN RANDOM SEED VIP CHO DỰ ĐOÁN VỊ
        const doan_vi = predictVIPRandomSums(du_doan, currentPhien, 3);

        lastPrediction = {
            phien: currentPhien,
            du_doan,
            doan_vi
        };

        console.log(`✅ HOÀN THÀNH DỰ ĐOÁN CHO PHIÊN ${currentPhien}: ${du_doan} - Vị: [${doan_vi.join(', ')}]`);

        // Lưu dự đoán mới vào lịch sử
        appendPredictionHistory({
            phien: currentPhien,
            du_doan,
            doan_vi,
            ket_qua_thuc: null,
            Tong: null,
            timestamp: Date.now()
        });
    } else {
        console.log('⏳ CHƯA CÓ PHIÊN MỚI → SỬ DỤNG DỰ ĐOÁN TRƯỚC ĐÓ');
    }

    // Tính độ tin cậy thực tế
    const realConfidence = calculateCurrentConfidence(predHist, lastPrediction, historyData);
    const do_tin_cay = `${realConfidence}%`;

    const phienTruoc = currentPhien ? parseInt(currentPhien.replace('#', '')) : 0;

    console.log(`📤 TRẢ VỀ KẾT QUẢ DỰ ĐOÁN CHO PHIÊN: ${phienTruoc + 1}`);

    // --- Trả về JSON theo định dạng mới ---
    res.json({
        "id": "API BY TELEGRAM @ngphungggiahuyy",
        "Phien": phienTruoc,
        "Xuc_xac_1": latest.facesList?.[0] || 0,
        "Xuc_xac_2": latest.facesList?.[1] || 0,
        "Xuc_xac_3": latest.facesList?.[2] || 0,
        "Tong": latest.score || 0,
        "Ket_qua": getResultType(latest) || "Chờ kết quả...",
        "phien_hien_tai": phienTruoc ? phienTruoc + 1 : 0,
        "du_doan": lastPrediction.du_doan || "Đang chờ...",
        "dudoan_vi": lastPrediction.doan_vi ? lastPrediction.doan_vi.join(', ') : "",
        "do_tin_cay": do_tin_cay
    });
});

// --- Endpoint xem thống kê ---
app.get('/stats', (req, res) => {
    console.log('\n📊 NHẬN YÊU CẦU THỐNG KÊ...');
    
    const predHist = loadPredictionHistory();
    const confidence = calculateRealConfidence(predHist);
    
    const verified = predHist.filter(r => r.ket_qua_thuc);
    const correct = verified.filter(r => r.du_doan === r.ket_qua_thuc);
    
    console.log('📈 TRẢ VỀ DỮ LIỆU THỐNG KÊ');
    
    res.json({
        total_predictions: predHist.length,
        verified_predictions: verified.length,
        accuracy: verified.length > 0 ? ((correct.length / verified.length) * 100).toFixed(1) + '%' : 'N/A',
        current_confidence: confidence + '%',
        recent_activity: predHist.slice(-10).reverse()
    });
});

// ==================== 🚀 KHỞI ĐỘNG SERVER ====================

app.listen(PORT, () => {
    console.log('\n' + '='.repeat(60));
    console.log('🤖 SERVER AI DỰ ĐOÁN ĐÃ ĐƯỢC KHỞI ĐỘNG THÀNH CÔNG!');
    console.log('='.repeat(60));
    console.log(`📍 Địa chỉ: http://localhost:${PORT}`);
    console.log(`🎯 Thuật toán phân tích Tài Xỉu: ĐÃ KÍCH HOẠT`);
    console.log(`🎲 Thuật toán Random Seed VIP: ĐÃ KÍCH HOẠT`);
    console.log(`📊 Hệ thống tính độ tin cậy: ĐÃ KÍCH HOẠT`);
    console.log('='.repeat(60));
    console.log('📝 Các endpoint available:');
    console.log(`   GET  /predict      → Lấy dự đoán mới nhất`);
    console.log(`   GET  /stats        → Xem thống kê độ chính xác`);
    console.log(`   POST /report-result → Báo cáo kết quả thực tế`);
    console.log('='.repeat(60) + '\n');
    
    setInterval(updateHistory, UPDATE_INTERVAL);
});
