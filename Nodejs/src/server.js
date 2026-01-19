const express = require('express');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());

const DATA_DIR = path.join(__dirname, '../data');
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

function getTaiXiu(sum) {
    return sum >= 11 ? 'Tài' : 'Xỉu';
}

const sumModule = require('./routes/sum');
const sicbo789Module = require('./routes/sicbo789');
const sicbob52Module = require('./routes/sicbob52');
const sicbohitModule = require('./routes/sicbohit');
const sicbosunModule = require('./routes/sicbosun');
const luck8Module = require('./routes/luck8');
const luck8Md5Module = require('./routes/luck8_md5');
const betvipModule = require('./routes/betvip');
const betvipTaixiuModule = require('./routes/betvip_taixiu');

const game789Module = require('./routes/789');
const hitModule = require('./routes/hit');
const sunModule = require('./routes/sun');
const b52Module = require('./routes/b52');
const lc79Module = require('./routes/lc79');

app.use('/sum', sumModule);
app.use('/luck8', luck8Module);
app.use('/luck8/md5', luck8Md5Module);
app.use('/betvip', betvipModule);
app.use('/betvip/taixiu', betvipTaixiuModule);

app.use('/789', game789Module);
app.use('/789/sicbo', sicbo789Module);

app.use('/hit', hitModule);
app.use('/hit/sicbo', sicbohitModule);

app.use('/sun', sunModule);
app.use('/sun/sicbo', sicbosunModule);

app.use('/b52', b52Module);
app.use('/b52/sicbo', sicbob52Module);

app.use('/lc79', lc79Module);

app.get('/', (req, res) => {
    res.json({
        id: '@mryanhdz',
        group: '@cutools',
        api_name: 'API ALL IN ONE BY NHAY',
        message: 'API Server - All in One by Bo Nhay DZ',
        endpoints: {
            '789': {
                taixiu: '/789/taixiu',
                taixiu_lichsu: '/789/taixiu/ls',
                taixiu_dudoan: '/789/taixiu/lsdudoan',
                sicbo: '/789/sicbo',
                sicbo_lichsu: '/789/sicbo/ls',
                sicbo_dudoan: '/789/sicbo/lsdudoan',
                stats: '/789/stats'
            },
            'hit': {
                hu: '/hit/hu',
                hu_lichsu: '/hit/hu/ls',
                hu_dudoan: '/hit/hu/lsdudoan',
                md5: '/hit/md5',
                md5_lichsu: '/hit/md5/ls',
                md5_dudoan: '/hit/md5/lsdudoan',
                sicbo: '/hit/sicbo',
                sicbo_lichsu: '/hit/sicbo/ls',
                sicbo_dudoan: '/hit/sicbo/lsdudoan',
                stats: '/hit/stats'
            },
            'sun': {
                taixiu: '/sun/taixiu',
                taixiu_lichsu: '/sun/taixiu/ls',
                taixiu_dudoan: '/sun/taixiu/lsdudoan',
                sicbo: '/sun/sicbo',
                sicbo_lichsu: '/sun/sicbo/ls',
                sicbo_dudoan: '/sun/sicbo/lsdudoan',
                stats: '/sun/stats'
            },
            'b52': {
                taixiu: '/b52/taixiu',
                taixiu_lichsu: '/b52/taixiu/ls',
                taixiu_dudoan: '/b52/taixiu/lsdudoan',
                sicbo: '/b52/sicbo',
                sicbo_lichsu: '/b52/sicbo/ls',
                sicbo_dudoan: '/b52/sicbo/lsdudoan',
                stats: '/b52/stats'
            },
            'lc79': {
                hu: '/lc79/hu',
                hu_lichsu: '/lc79/hu/ls',
                hu_dudoan: '/lc79/hu/lsdudoan',
                md5: '/lc79/md5',
                md5_lichsu: '/lc79/md5/ls',
                md5_dudoan: '/lc79/md5/lsdudoan'
            },
            'luck8': {
                main: '/luck8',
                lichsu: '/luck8/lichsu',
                taixiu: '/luck8/taixiu',
                taixiu_lichsu: '/luck8/taixiu/ls',
                taixiu_dudoan: '/luck8/taixiu/lsdudoan',
                md5: '/luck8/md5/taixiu',
                md5_lichsu: '/luck8/md5/taixiu/ls',
                md5_dudoan: '/luck8/md5/taixiu/lsdudoan'
            },
            'sum': {
                main: '/sum',
                taixiu: '/sum/taixiu',
                taixiu_lichsu: '/sum/taixiu/ls',
                taixiu_dudoan: '/sum/taixiu/lsdudoan',
                stats: '/sum/stats'
            },
            'betvip': {
                main: '/betvip',
                md5: '/betvip/md5',
                md5_lichsu: '/betvip/md5/ls',
                md5_dudoan: '/betvip/md5/lsdudoan',
                taixiu: '/betvip/taixiu',
                taixiu_lichsu: '/betvip/taixiu/ls',
                taixiu_dudoan: '/betvip/taixiu/lsdudoan',
                stats: '/betvip/stats'
            }
        }
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server đang chạy tại http://0.0.0.0:${PORT}`);
    console.log('');
    console.log('Endpoints:');
    console.log('  /789/taixiu - 789 Tài Xỉu');
    console.log('  /789/sicbo - 789 Sicbo');
    console.log('  /hit/hu - Hit Tài Xỉu Hũ');
    console.log('  /hit/md5 - Hit Tài Xỉu MD5');
    console.log('  /hit/sicbo - Hit Sicbo');
    console.log('  /sun/taixiu - Sun Tài Xỉu');
    console.log('  /sun/sicbo - Sun Sicbo');
    console.log('  /b52/taixiu - B52 Tài Xỉu');
    console.log('  /b52/sicbo - B52 Sicbo');
    console.log('  /lc79/hu - LC79 Tài Xỉu Hũ');
    console.log('  /lc79/md5 - LC79 Tài Xỉu MD5');
});
