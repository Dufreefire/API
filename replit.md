# Tài Xỉu Prediction API

## Overview

This is a Node.js-based prediction system for Vietnamese dice games (Tài Xỉu / Sicbo). The application fetches real-time game data from multiple external gaming platforms, analyzes historical patterns using various statistical and AI-based algorithms, and generates predictions for upcoming game rounds. The system supports multiple game providers including B52, Sun, Hit, 789, Luck8, and Betvip.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Backend Framework
- **Express.js (v5.x)** serves as the REST API framework
- Single server entry point at `Nodejs/src/server.js` running on port 5000
- Modular route structure with separate files per game provider in `Nodejs/src/routes/`

### Core AI Engine
- Custom `AIEngine` class (`Nodejs/src/core/AIEngine.js`) implements prediction logic
- `GameAIFactory` (`Nodejs/src/core/GameAIFactory.js`) provides game-specific configurations and engine instances
- Pattern detection algorithms including:
  - Streak analysis (cầu bệt, cầu đảo)
  - Markov chain transitions
  - Fibonacci patterns
  - Momentum and volatility tracking
  - Adaptive weight adjustments based on prediction accuracy

### Data Flow
1. External APIs are polled at regular intervals (typically 3-5 seconds)
2. Game history is normalized and stored in JSON files
3. Pattern analysis runs against historical data
4. Predictions are generated with confidence scores
5. Results are verified against actual outcomes to update learning weights

### Route Organization
Each game provider has dedicated routes:
- `/789`, `/sun`, `/hit`, `/b52` - Main game predictions
- `/789/sicbo`, `/sun/sicbo`, `/hit/sicbo`, `/b52/sicbo` - Sicbo variant predictions
- `/luck8`, `/betvip`, `/sum` - Additional platform support
- `/lc79` - LC79 platform with HU and MD5 variants

### Data Persistence
- JSON files store prediction history, learning data, and external game history
- Files organized in `Nodejs/data/` and `Nodejs/src/data/history/` directories
- Auto-save mechanisms run every 30 seconds
- Learning data includes pattern weights, transition matrices, and accuracy metrics

### Prediction Algorithm Features
- Confidence scoring (typically 55-85% range)
- Multiple pattern detection (streak, alternating, pairs, triplets)
- Reversal state tracking for consecutive losses
- Adaptive thresholds based on recent accuracy
- Support for "Tài" (high: 11-17), "Xỉu" (low: 4-10), and "Bão" (triples) outcomes

## External Dependencies

### NPM Packages
- **express** (v5.2.1) - Web framework
- **axios** (v1.13.2) - HTTP client for external API calls
- **ws** (v8.19.0) - WebSocket support for real-time data
- **cors** (v2.8.5) - Cross-origin resource sharing
- **node-fetch** (v2.7.0) - Fetch API polyfill

### External Gaming APIs
The system integrates with multiple gaming platform APIs:
- `api.wsmt8g.cc` - B52 and Hit Sicbo history
- `api.xeuigogo.info` - 789 Sicbo history
- `api.wsktnus8.net` - Sun Sicbo history
- `jakpotgwab.geightdors.net` - Hit HU/MD5 games
- `wtx.tele68.com` / `wtxmd52.tele68.com` - LC79 games
- `wtxmd52.macminim6.online` - Betvip games
- `luck8bot.com` - Luck8 lottery data
- `taixiu1.gsum01.com` - Sum game data
- `b52-qiw2.onrender.com` - B52 main game history

### Data Storage
- File-based JSON storage (no database required)
- Separate files for each game provider's history and learning data
- Prediction verification against actual outcomes stored for accuracy tracking